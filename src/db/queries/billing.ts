import "server-only";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { listerProfiles, plans, properties, subscriptions, users } from "@/db/schema";
import { ACTIVE_LISTING_STATUSES, type PlanKind } from "@/lib/billing/constants";
import { canPublish, type PublishEntitlement } from "@/lib/billing/entitlements";
import { subscriptionPhase, type SubscriptionPhase } from "@/lib/billing/periods";

/**
 * Billing reads used by later slices (publish checks in S3, billing pages in S6). Entitlement is
 * decided here on the server from stored rows; nothing comes from the browser.
 */

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;

/**
 * Whose listing plan applies (prompt s2 decision 4): an agency member uses the agency's plan and
 * shares its limit; everyone else uses their own.
 */
export type ListingPool = { kind: "agency"; agencyId: string } | { kind: "user"; userId: string };

/** Statuses that hold an owner's single live subscription slot (matches the partial unique index). */
const LIVE_STATUSES = ["pending", "active", "past_due", "paused"] as const;

export async function getActivePlans(db: DbExecutor, kind?: PlanKind): Promise<Plan[]> {
  return db
    .select()
    .from(plans)
    .where(kind ? and(eq(plans.isActive, true), eq(plans.kind, kind)) : eq(plans.isActive, true))
    .orderBy(asc(plans.priceKes), asc(plans.code));
}

export async function getListingPool(db: DbExecutor, userId: string): Promise<ListingPool> {
  const [row] = await db
    .select({ agencyId: listerProfiles.agencyId })
    .from(listerProfiles)
    .where(eq(listerProfiles.userId, userId))
    .limit(1);
  return row?.agencyId ? { kind: "agency", agencyId: row.agencyId } : { kind: "user", userId };
}

/** The pool's live listing subscription and its plan's limit, or null when there is none. */
export async function getListingSubscription(
  db: DbExecutor,
  pool: ListingPool,
): Promise<{ subscription: Subscription; listingLimit: number | null } | null> {
  const owner =
    pool.kind === "agency"
      ? eq(subscriptions.ownerAgencyId, pool.agencyId)
      : eq(subscriptions.ownerUserId, pool.userId);
  const [row] = await db
    .select({ subscription: subscriptions, listingLimit: plans.listingLimit })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(owner, eq(subscriptions.kind, "listing"), inArray(subscriptions.status, [...LIVE_STATUSES])))
    .limit(1);
  return row ?? null;
}

/** Listings using a slot in the pool's limit: published or waiting for review. */
export async function countActiveListings(db: DbExecutor, pool: ListingPool): Promise<number> {
  const owner =
    pool.kind === "agency" ? eq(properties.agencyId, pool.agencyId) : eq(properties.ownerUserId, pool.userId);
  const [row] = await db
    .select({ n: count() })
    .from(properties)
    .where(and(owner, inArray(properties.status, [...ACTIVE_LISTING_STATUSES])));
  return row?.n ?? 0;
}

/** Whether this lister may put one more listing live (publish, submit or un-pause) right now. */
export async function getPublishEntitlement(
  db: DbExecutor,
  userId: string,
  now: Date = new Date(),
): Promise<PublishEntitlement> {
  const pool = await getListingPool(db, userId);
  const [plan, activeListingCount] = await Promise.all([
    getListingSubscription(db, pool),
    countActiveListings(db, pool),
  ]);
  return canPublish({
    subscription: plan?.subscription ?? null,
    listingLimit: plan?.listingLimit ?? null,
    activeListingCount,
    now,
  });
}

export interface ListingPlanUsage {
  /** Null when the pool has no live listing subscription. */
  limit: number | null;
  phase: SubscriptionPhase | null;
  activeListingCount: number;
  pool: ListingPool;
}

/** "x of y active listings used" for the lister dashboard and the create-listing panel. */
export async function getListingPlanUsage(
  db: DbExecutor,
  userId: string,
  now: Date = new Date(),
): Promise<ListingPlanUsage> {
  const pool = await getListingPool(db, userId);
  const [plan, activeListingCount] = await Promise.all([
    getListingSubscription(db, pool),
    countActiveListings(db, pool),
  ]);
  return {
    limit: plan?.listingLimit ?? null,
    phase: plan ? subscriptionPhase(plan.subscription, now) : null,
    activeListingCount,
    pool,
  };
}

/** The verified badge. The rule lives only in the database (`lister_verified_now`). */
export async function isListerVerified(db: DbExecutor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ verified: sql<boolean>`lister_verified_now(${users.id})` })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.verified === true;
}
