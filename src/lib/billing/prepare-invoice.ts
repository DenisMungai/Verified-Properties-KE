import "server-only";
import type { DbExecutor } from "@/db/executor";
import { getListingPool, type ListingPool } from "@/db/queries/billing";
import { getListerProfile } from "@/db/queries/lister-profiles";
import {
  getActivePlanByCode,
  getPlan,
  insertInvoice,
  insertPendingSubscription,
  isAgencyAdmin,
  lockLiveSubscription,
  openInvoices,
  switchPendingPlan,
  voidInvoices,
  type Invoice,
  type Plan,
} from "@/db/queries/payments";
import type { BillingDeps } from "./deps";
import { classifyPlanChange, type PlanChangeKind, type PlanTerms } from "./plan-change";

/**
 * What every way of paying shares (prompts S5 decision 5, S6 decisions 2 and 15): who may buy
 * which plan, and the open invoice to pay. Price, plan and owner always come from the database.
 */

export type PurchaseRefusal = "no_profile" | "plan_not_found" | "plan_not_available" | "agency_admin_only";

export const PURCHASE_MESSAGES: Record<PurchaseRefusal | "use_schedule", string> = {
  no_profile: "Set up your lister profile before choosing a plan.",
  plan_not_found: "That plan isn't available. Choose another plan.",
  plan_not_available: "That plan isn't available for your account.",
  agency_admin_only: "Your agency's plan is paid by an agency admin. Ask them to renew it.",
  use_schedule: "A smaller plan starts when your current period ends, so there's nothing to pay now. Schedule the change instead.",
};

export function planTerms(plan: Plan): PlanTerms {
  return { id: plan.id, code: plan.code, name: plan.name, priceKes: plan.priceKes, listingLimit: plan.listingLimit };
}

/** Listing plans this pool may buy: agency pools buy agency plans, everyone else the others. */
export function planFitsPool(plan: Plan, pool: ListingPool): boolean {
  return plan.kind === "listing" && plan.priceKes > 0 && plan.isAgencyPlan === (pool.kind === "agency");
}

export type ResolvedPurchase = { ok: true; pool: ListingPool; plan: Plan } | { ok: false; code: PurchaseRefusal };

export async function resolvePurchase(db: DbExecutor, userId: string, planCode: string): Promise<ResolvedPurchase> {
  if (!(await getListerProfile(db, userId))) return { ok: false, code: "no_profile" };
  const plan = await getActivePlanByCode(db, planCode);
  if (!plan) return { ok: false, code: "plan_not_found" };
  // Verification is bought in Phase 2, where paying starts a review.
  const pool = await getListingPool(db, userId);
  if (pool.kind === "agency" && !(await isAgencyAdmin(db, userId, pool.agencyId))) {
    return { ok: false, code: "agency_admin_only" };
  }
  if (!planFitsPool(plan, pool)) return { ok: false, code: "plan_not_available" };
  return { ok: true, pool, plan };
}

export type PreparedInvoice =
  | { ok: true; invoice: Invoice; kind: PlanChangeKind }
  | { ok: false; code: "use_schedule" | "in_flight" };

/**
 * Locks the owner's subscription, decides what paying for `plan` means, then finds or creates the
 * open invoice for it. Runs in one transaction; network calls happen after it commits.
 * `inFlight` lets M-Pesa refuse a second push while one is waiting on the phone.
 */
export async function preparePlanInvoice(
  deps: Pick<BillingDeps, "withTransaction" | "now">,
  owner: ListingPool,
  plan: Plan,
  inFlight?: (tx: DbExecutor, invoice: Invoice, now: Date) => Promise<boolean>,
): Promise<PreparedInvoice> {
  const now = deps.now();
  return deps.withTransaction(async (tx) => {
    let sub = await lockLiveSubscription(tx, owner, plan.kind);
    const currentPlan = sub ? await getPlan(tx, sub.planId) : null;
    const kind = classifyPlanChange({
      current: sub && currentPlan ? { subscription: sub, plan: planTerms(currentPlan) } : null,
      target: planTerms(plan),
      now,
    });
    if (kind === "downgrade") return { ok: false, code: "use_schedule" };
    if (!sub) {
      sub = await insertPendingSubscription(tx, owner, plan);
    } else if (kind === "switch_unpaid") {
      await switchPendingPlan(tx, sub.id, plan.id);
    }

    const open = await openInvoices(tx, sub.id);
    const reusable = open.find((i) => i.planId === plan.id && i.amountKes === plan.priceKes) ?? null;
    await voidInvoices(
      tx,
      open.filter((i) => i.id !== reusable?.id).map((i) => i.id),
      now,
    );
    if (reusable && inFlight && (await inFlight(tx, reusable, now))) return { ok: false, code: "in_flight" };
    const invoice =
      reusable ?? (await insertInvoice(tx, { subscriptionId: sub.id, planId: plan.id, amountKes: plan.priceKes }));
    return { ok: true, invoice, kind };
  });
}
