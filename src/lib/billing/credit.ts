import { BILLING_PERIOD_DAYS, DAY_MS, PAID_SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "./constants";
import { graceEndsAt, subscriptionPhase, type SubscriptionTiming } from "./periods";

/**
 * Admin credits (prompt S10 decision 7): days added to a paid period, never shillings and never a
 * fresh period, so entitlement still starts from a confirmed payment. Pure; client-safe.
 */

/** Goodwill credits from the subscription panel. */
export const MAX_GOODWILL_CREDIT_DAYS = 30;
/** Matches the `billing_audit_log_credit_days_range` check. */
export const MAX_CREDIT_DAYS = 365;

/**
 * Days a payment that bought nothing is worth on the plan in force: 30 days per plan price,
 * rounded down (the S6 day-credit approach). 0 means "too little to credit; refund instead".
 */
export function creditDaysFromPayment(paidAmountKes: number, planPriceKes: number): number {
  if (!Number.isInteger(paidAmountKes) || paidAmountKes <= 0 || planPriceKes <= 0) return 0;
  return Math.min(MAX_CREDIT_DAYS, Math.floor((BILLING_PERIOD_DAYS * paidAmountKes) / planPriceKes));
}

/** A credit only extends a period someone paid for and that hasn't lapsed (active or in grace). */
export function canReceiveCredit(sub: SubscriptionTiming, now: Date): boolean {
  if (!(PAID_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(sub.status)) return false;
  const phase = subscriptionPhase(sub, now);
  return phase === "active" || phase === "grace";
}

export interface CreditedPeriod {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  graceEndsAt: Date;
  /** Unchanged unless a downgrade was scheduled for the old period end; then it moves too. */
  scheduledChangeAt: Date | null;
}

/** The subscription after `days` are added to its paid period end. Call `canReceiveCredit` first. */
export function extendPeriodByDays(
  sub: { status: SubscriptionStatus; currentPeriodEnd: Date; scheduledChangeAt: Date | null },
  days: number,
  now: Date,
): CreditedPeriod {
  const currentPeriodEnd = new Date(sub.currentPeriodEnd.getTime() + days * DAY_MS);
  const scheduleFollowsEnd = sub.scheduledChangeAt !== null && sub.scheduledChangeAt.getTime() === sub.currentPeriodEnd.getTime();
  return {
    status: sub.status === "past_due" && currentPeriodEnd.getTime() > now.getTime() ? "active" : sub.status,
    currentPeriodEnd,
    graceEndsAt: graceEndsAt(currentPeriodEnd),
    scheduledChangeAt: scheduleFollowsEnd ? currentPeriodEnd : sub.scheduledChangeAt,
  };
}
