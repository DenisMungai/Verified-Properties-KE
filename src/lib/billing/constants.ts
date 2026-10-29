/**
 * Billing constants (plan v2.0 §4, §16). The database view `verified_listers_now` encodes the
 * same "paid up or in grace" rule in SQL; keep the two in step.
 */

/** A billing period runs 30 days from the confirmed payment. */
export const BILLING_PERIOD_DAYS = 30;

/** After a period ends, listings and the badge stay up for 3 more days. */
export const GRACE_DAYS = 3;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Listing statuses that use a slot in the plan's active-listing limit. */
export const ACTIVE_LISTING_STATUSES = ["published", "pending_review"] as const;

export const PLAN_KINDS = ["listing", "verification"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_CODES = {
  starter: "starter",
  pro: "pro",
  agency: "agency",
  verification: "verification",
} as const;
export type PlanCode = (typeof PLAN_CODES)[keyof typeof PLAN_CODES];

export const SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "past_due",
  "paused",
  "cancelled",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses that can still be paid up or in grace; the period end decides which. */
export const PAID_SUBSCRIPTION_STATUSES = ["active", "past_due"] as const satisfies readonly SubscriptionStatus[];
