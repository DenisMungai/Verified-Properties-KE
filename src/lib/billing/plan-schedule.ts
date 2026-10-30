import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { getListingPool, getListingSubscription, type ListingPool } from "@/db/queries/billing";
import {
  getPlan,
  isAgencyAdmin,
  lockLiveSubscription,
  openInvoices,
  recordPaymentEvent,
  updateSubscription,
  voidInvoices,
  type Subscription,
} from "@/db/queries/payments";
import { properties } from "@/db/schema";
import { ACTIVE_LISTING_STATUSES } from "./constants";
import type { BillingDeps } from "./deps";
import { classifyPlanChange } from "./plan-change";
import { PURCHASE_MESSAGES, planTerms, resolvePurchase, type PurchaseRefusal } from "./prepare-invoice";

/**
 * Downgrades (prompt S6 decisions 3 and 4): scheduled for the period end with nothing to pay, can
 * be cancelled before then, and once in force the lister chooses which listings stay live.
 */

type Deps = Pick<BillingDeps, "db" | "withTransaction" | "now">;

export type ScheduleCode = PurchaseRefusal | "no_plan" | "not_downgrade" | "nothing_scheduled" | "not_over_limit" | "invalid_choice";

export type ScheduleResult = { ok: true; changeAt: Date | null } | { ok: false; code: ScheduleCode; message: string };

const MESSAGES: Record<ScheduleCode, string> = {
  ...PURCHASE_MESSAGES,
  no_plan: "You don't have a paid listing plan to change.",
  not_downgrade: "That plan isn't a smaller plan. Choose it on the checkout page instead.",
  nothing_scheduled: "There's no plan change waiting to be cancelled.",
  not_over_limit: "All your live listings fit your plan, so there's nothing to choose.",
  invalid_choice: "Choose listings from your live listings, up to your plan's limit.",
};

const fail = (code: ScheduleCode): ScheduleResult => ({ ok: false, code, message: MESSAGES[code] });

async function scheduleEvent(tx: DbExecutor, sub: Subscription, payload: Record<string, unknown>): Promise<void> {
  await recordPaymentEvent(tx, { eventType: "status_change", payload: { entity: "subscription", subscriptionId: sub.id, ...payload } });
}

/** Agency pools are managed by their admins only. */
async function managedPool(db: DbExecutor, userId: string): Promise<ListingPool | null> {
  const pool = await getListingPool(db, userId);
  if (pool.kind === "agency" && !(await isAgencyAdmin(db, userId, pool.agencyId))) return null;
  return pool;
}

export async function scheduleDowngrade(deps: Deps, userId: string, planCode: string): Promise<ScheduleResult> {
  const purchase = await resolvePurchase(deps.db, userId, planCode);
  if (!purchase.ok) return fail(purchase.code);
  const { pool, plan } = purchase;
  const now = deps.now();

  return deps.withTransaction(async (tx) => {
    const sub = await lockLiveSubscription(tx, pool, "listing");
    const currentPlan = sub ? await getPlan(tx, sub.planId) : null;
    if (!sub || !currentPlan || !sub.currentPeriodEnd) return fail("no_plan");
    const kind = classifyPlanChange({
      current: { subscription: sub, plan: planTerms(currentPlan) },
      target: planTerms(plan),
      now,
    });
    if (kind !== "downgrade") return fail("not_downgrade");

    const changeAt = sub.currentPeriodEnd;
    await updateSubscription(tx, sub.id, { scheduledPlanId: plan.id, scheduledChangeAt: changeAt });
    // A stale renewal invoice for the plan being left must not renew it by Paybill.
    const stale = (await openInvoices(tx, sub.id)).filter((i) => i.planId !== plan.id).map((i) => i.id);
    await voidInvoices(tx, stale, now);
    await scheduleEvent(tx, sub, {
      action: "downgrade_scheduled",
      planFrom: sub.planId,
      planTo: plan.id,
      changeAt: changeAt.toISOString(),
    });
    console.info(`[billing] downgrade scheduled subscription=${sub.id} changeAt=${changeAt.toISOString()}`);
    return { ok: true, changeAt };
  });
}

export async function cancelScheduledChange(deps: Deps, userId: string): Promise<ScheduleResult> {
  const pool = await managedPool(deps.db, userId);
  if (!pool) return fail("agency_admin_only");
  const now = deps.now();

  return deps.withTransaction(async (tx) => {
    const sub = await lockLiveSubscription(tx, pool, "listing");
    if (!sub?.scheduledPlanId || !sub.scheduledChangeAt || sub.scheduledChangeAt.getTime() <= now.getTime()) {
      return fail("nothing_scheduled");
    }
    const scheduledPlanId = sub.scheduledPlanId;
    await updateSubscription(tx, sub.id, { scheduledPlanId: null, scheduledChangeAt: null });
    const stale = (await openInvoices(tx, sub.id)).filter((i) => i.planId === scheduledPlanId).map((i) => i.id);
    await voidInvoices(tx, stale, now);
    await scheduleEvent(tx, sub, { action: "downgrade_cancelled", planTo: scheduledPlanId });
    return { ok: true, changeAt: null };
  });
}

/** The pool's listings using a slot, newest first: what the keep form offers. */
export async function listingsUsingSlots(db: DbExecutor, pool: ListingPool) {
  const owner = pool.kind === "agency" ? eq(properties.agencyId, pool.agencyId) : eq(properties.ownerUserId, pool.userId);
  return db
    .select({
      id: properties.id,
      title: properties.title,
      town: properties.town,
      neighbourhood: properties.neighbourhood,
      status: properties.status,
      publishedAt: properties.publishedAt,
    })
    .from(properties)
    .where(and(owner, inArray(properties.status, [...ACTIVE_LISTING_STATUSES])))
    .orderBy(desc(properties.publishedAt), desc(properties.createdAt));
}

/**
 * After a downgrade is in force: keep `keepIds` live and take the rest out (decision 4).
 * Published listings are paused for the limit, so a later renewal or upgrade restores them.
 * Listings waiting for review go back to draft instead: a paused listing is restored straight to
 * published, which would skip the review.
 */
export async function keepListingsAfterDowngrade(deps: Deps, userId: string, keepIds: readonly string[]): Promise<ScheduleResult> {
  const pool = await managedPool(deps.db, userId);
  if (!pool) return fail("agency_admin_only");
  const now = deps.now();

  return deps.withTransaction(async (tx) => {
    const sub = await lockLiveSubscription(tx, pool, "listing");
    const plan = sub ? await getListingSubscription(tx, pool, now) : null;
    const limit = plan?.listingLimit ?? null;
    if (!sub || limit === null) return fail("no_plan");

    const owner = pool.kind === "agency" ? eq(properties.agencyId, pool.agencyId) : eq(properties.ownerUserId, pool.userId);
    const active = await tx
      .select({ id: properties.id, status: properties.status })
      .from(properties)
      .where(and(owner, inArray(properties.status, [...ACTIVE_LISTING_STATUSES])))
      .for("update");
    if (active.length <= limit) return fail("not_over_limit");

    const keep = new Set(keepIds);
    const activeIds = new Set(active.map((row) => row.id));
    if (keep.size > limit || [...keep].some((id) => !activeIds.has(id))) return fail("invalid_choice");

    const { paused, toDraft } = await applyKeepSelection(tx, active, keep, now);
    await scheduleEvent(tx, sub, { action: "listings_kept", kept: keep.size, paused, toDraft });
    console.info(`[billing] downgrade choice subscription=${sub.id} kept=${keep.size} paused=${paused} draft=${toDraft}`);
    return { ok: true, changeAt: null };
  });
}

/**
 * Takes the listings not in `keep` out of the plan's limit: published ones are paused for the
 * limit, ones in review go back to draft. Shared by the lister's choice and the S9 auto-pick.
 * `active` must be the pool's slot-using listings, locked by the caller.
 */
export async function applyKeepSelection(
  tx: DbExecutor,
  active: readonly { id: string; status: string }[],
  keep: ReadonlySet<string>,
  now: Date,
): Promise<{ paused: number; toDraft: number }> {
  const leaving = active.filter((row) => !keep.has(row.id));
  const toPause = leaving.filter((row) => row.status === "published").map((row) => row.id);
  const toDraft = leaving.filter((row) => row.status === "pending_review").map((row) => row.id);
  if (toPause.length > 0) {
    await tx
      .update(properties)
      .set({ status: "paused", pausedAt: now, pauseReason: "over_plan_limit" })
      .where(and(inArray(properties.id, toPause), eq(properties.status, "published")));
  }
  if (toDraft.length > 0) {
    await tx
      .update(properties)
      .set({ status: "draft" })
      .where(and(inArray(properties.id, toDraft), eq(properties.status, "pending_review")));
  }
  return { paused: toPause.length, toDraft: toDraft.length };
}
