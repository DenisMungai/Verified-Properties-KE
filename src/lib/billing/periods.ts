import {
  BILLING_PERIOD_DAYS,
  DAY_MS,
  GRACE_DAYS,
  PAID_SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from "./constants";

/**
 * Billing-period maths (plan v2.0 §4). Pure: every function takes `now` or the dates it needs and
 * never reads the clock.
 */

export interface BillingPeriod {
  start: Date;
  end: Date;
  graceEndsAt: Date;
}

/** The subscription fields that decide its phase. */
export interface SubscriptionTiming {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
}

/**
 * - pending: not paid yet
 * - active: paid up; publishing allowed
 * - grace: period ended less than GRACE_DAYS ago; live listings and the badge stay up
 * - lapsed: past grace, or paused, cancelled or expired
 */
export type SubscriptionPhase = "pending" | "active" | "grace" | "lapsed";

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function graceEndsAt(periodEnd: Date): Date {
  return addDays(periodEnd, GRACE_DAYS);
}

/**
 * The period a confirmed payment buys. It starts at the later of the confirmation time and the
 * current period end, so renewing early adds 30 days and never shortens what was paid for.
 */
export function nextPeriod({
  confirmedAt,
  currentPeriodEnd,
}: {
  confirmedAt: Date;
  currentPeriodEnd: Date | null;
}): BillingPeriod {
  const start =
    currentPeriodEnd && currentPeriodEnd.getTime() > confirmedAt.getTime() ? currentPeriodEnd : confirmedAt;
  const end = addDays(start, BILLING_PERIOD_DAYS);
  return { start, end, graceEndsAt: graceEndsAt(end) };
}

export function subscriptionPhase(sub: SubscriptionTiming, now: Date): SubscriptionPhase {
  if (sub.status === "pending") return "pending";
  const paid = (PAID_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(sub.status);
  if (!paid || !sub.currentPeriodEnd || !sub.graceEndsAt) return "lapsed";
  const t = now.getTime();
  if (t < sub.currentPeriodEnd.getTime()) return "active";
  if (t < sub.graceEndsAt.getTime()) return "grace";
  return "lapsed";
}
