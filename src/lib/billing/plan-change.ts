import { formatNairobiDate } from "@/lib/format";
import { BILLING_PERIOD_DAYS, DAY_MS, PAID_SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "./constants";
import { graceEndsAt, nextPeriod, subscriptionPhase, type SubscriptionTiming } from "./periods";

/**
 * Plan changes (prompt S6 decisions 1–3). Pure: callers load the rows and pass `now`.
 * - Upgrade (higher listing limit): starts when paid, unused days of the current plan credited
 *   as extra days on the new one. The invoice is always the new plan's full price.
 * - Downgrade (lower limit): scheduled for the period end, nothing to pay now.
 * - Lapsed: any plan starts fresh from the payment, without credit.
 */

export interface PlanTerms {
  id: string;
  code: string;
  name: string;
  priceKes: number;
  listingLimit: number | null;
}

export interface SubscriptionState extends SubscriptionTiming {
  planId: string;
  currentPeriodStart: Date | null;
  scheduledPlanId: string | null;
  scheduledChangeAt: Date | null;
}

export type PlanChangeKind = "new" | "switch_unpaid" | "renew" | "upgrade" | "downgrade" | "restart";

const limitOf = (plan: Pick<PlanTerms, "listingLimit">) => plan.listingLimit ?? 0;

function isPaidStatus(status: SubscriptionStatus): boolean {
  return (PAID_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(status);
}

/** What choosing `target` means for the owner's live subscription right now (decision 2 table). */
export function classifyPlanChange({
  current,
  target,
  now,
}: {
  current: { subscription: SubscriptionState; plan: PlanTerms } | null;
  target: PlanTerms;
  now: Date;
}): PlanChangeKind {
  if (!current) return "new";
  const { subscription, plan } = current;
  switch (subscriptionPhase(subscription, now)) {
    case "pending":
      return target.id === plan.id ? "new" : "switch_unpaid";
    case "lapsed":
      return "restart";
    case "active":
    case "grace":
      if (target.id === plan.id || target.id === subscription.scheduledPlanId) return "renew";
      return limitOf(target) > limitOf(plan) ? "upgrade" : "downgrade";
  }
}

/**
 * Whole days of the new plan that the unused part of the current period buys:
 * floor(unused × paid / newPrice), floored once at the end. 0 when nothing is left to credit.
 */
export function upgradeCreditDays({
  now,
  currentPeriodEnd,
  paidAmountKes,
  newPriceKes,
}: {
  now: Date;
  currentPeriodEnd: Date | null;
  paidAmountKes: number | null;
  newPriceKes: number;
}): number {
  if (!currentPeriodEnd || paidAmountKes === null || paidAmountKes <= 0 || newPriceKes <= 0) return 0;
  const unusedMs = currentPeriodEnd.getTime() - now.getTime();
  if (unusedMs <= 0) return 0;
  return Math.floor((unusedMs * paidAmountKes) / (DAY_MS * newPriceKes));
}

export interface ConfirmationInput {
  subscription: SubscriptionState;
  currentPlan: PlanTerms;
  invoicePlan: PlanTerms;
  confirmedAt: Date;
  /** Amount of the paid invoice covering `confirmedAt`, for the upgrade credit. */
  coveringPaidAmountKes: number | null;
}

export interface ConfirmationChange {
  kind: "renew" | "scheduled_renew" | "upgrade" | "restart";
  /** The subscription's plan after confirmation. */
  planId: string;
  /** The period the invoice pays for. */
  periodStart: Date;
  periodEnd: Date;
  graceEndsAt: Date;
  /** The subscription's current_period_start (kept when the period runs on without a gap). */
  currentPeriodStart: Date;
  scheduledPlanId: string | null;
  scheduledChangeAt: Date | null;
  creditDays: number;
}

/** How a confirmed payment for `invoicePlan` changes the subscription (prompt S6 decisions 1–3). */
export function planChangeAtConfirmation({
  subscription: sub,
  currentPlan,
  invoicePlan,
  confirmedAt,
  coveringPaidAmountKes,
}: ConfirmationInput): ConfirmationChange {
  const phase = subscriptionPhase(sub, confirmedAt);
  const paidUp = phase === "active" || phase === "grace";
  const stackOn = isPaidStatus(sub.status) ? sub.currentPeriodEnd : null;
  const renewal = nextPeriod({ confirmedAt, currentPeriodEnd: stackOn });
  const continuous = stackOn !== null && stackOn.getTime() === renewal.start.getTime() && sub.currentPeriodStart !== null;
  const renewed = {
    periodStart: renewal.start,
    periodEnd: renewal.end,
    graceEndsAt: renewal.graceEndsAt,
    currentPeriodStart: continuous ? sub.currentPeriodStart! : renewal.start,
    creditDays: 0,
  };
  const fresh = (planId: string, extraDays: number) => {
    const end = new Date(confirmedAt.getTime() + (BILLING_PERIOD_DAYS + extraDays) * DAY_MS);
    return {
      planId,
      periodStart: confirmedAt,
      periodEnd: end,
      graceEndsAt: graceEndsAt(end),
      currentPeriodStart: confirmedAt,
      scheduledPlanId: null,
      scheduledChangeAt: null,
      creditDays: extraDays,
    };
  };
  /** Renewing onto a lower plan: it becomes the plan once `changeAt` has passed. */
  const scheduled = (planId: string, changeAt: Date): ConfirmationChange =>
    confirmedAt.getTime() >= changeAt.getTime()
      ? { kind: "scheduled_renew", planId, scheduledPlanId: null, scheduledChangeAt: null, ...renewed }
      : { kind: "scheduled_renew", planId: sub.planId, scheduledPlanId: planId, scheduledChangeAt: changeAt, ...renewed };

  if (invoicePlan.id === sub.planId) {
    // Paying for the current plan keeps it: any scheduled downgrade is dropped.
    return { kind: "renew", planId: sub.planId, scheduledPlanId: null, scheduledChangeAt: null, ...renewed };
  }
  if (invoicePlan.id === sub.scheduledPlanId && sub.scheduledChangeAt) {
    return scheduled(invoicePlan.id, sub.scheduledChangeAt);
  }
  if (paidUp && limitOf(invoicePlan) > limitOf(currentPlan)) {
    const credit = upgradeCreditDays({
      now: confirmedAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      paidAmountKes: coveringPaidAmountKes,
      newPriceKes: invoicePlan.priceKes,
    });
    return { kind: "upgrade", ...fresh(invoicePlan.id, credit) };
  }
  if (paidUp && sub.currentPeriodEnd) {
    // A lower plan paid while the current one runs (a stale Paybill invoice): it starts at the end.
    return scheduled(invoicePlan.id, sub.currentPeriodEnd);
  }
  return { kind: "restart", ...fresh(invoicePlan.id, 0) };
}

export interface CheckoutOption {
  kind: PlanChangeKind;
  /** What the lister pays now; 0 for a scheduled downgrade. */
  payKes: number;
  /** One line under the plan in the picker. */
  line: string;
  isCurrent: boolean;
}

/** The picker's preview for one plan. The credit is an estimate; it is fixed when the payment confirms. */
export function checkoutOption({
  current,
  target,
  now,
  coveringPaidAmountKes,
}: {
  current: { subscription: SubscriptionState; plan: PlanTerms } | null;
  target: PlanTerms;
  now: Date;
  coveringPaidAmountKes: number | null;
}): CheckoutOption {
  const kind = classifyPlanChange({ current, target, now });
  const sub = current?.subscription ?? null;
  const isCurrent = current !== null && current.plan.id === target.id && kind !== "restart";
  const pay = (line: string): CheckoutOption => ({ kind, payKes: target.priceKes, line, isCurrent });

  switch (kind) {
    case "new":
    case "switch_unpaid":
      return pay(`${BILLING_PERIOD_DAYS} days from when you pay`);
    case "restart":
      return pay("Starts when you pay");
    case "renew": {
      const end = sub?.currentPeriodEnd;
      const from = end && end.getTime() > now.getTime() ? `from ${formatNairobiDate(end)}` : "from when you pay";
      return pay(`Adds ${BILLING_PERIOD_DAYS} days ${from}`);
    }
    case "upgrade": {
      const days = upgradeCreditDays({
        now,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        paidAmountKes: coveringPaidAmountKes,
        newPriceKes: target.priceKes,
      });
      return pay(days > 0 ? `Starts now · about ${days} extra ${days === 1 ? "day" : "days"} from your current plan` : "Starts now");
    }
    case "downgrade": {
      const end = sub?.currentPeriodEnd;
      const from = end && end.getTime() > now.getTime() ? `Starts ${formatNairobiDate(end)}` : "Starts now";
      return { kind, payKes: 0, line: `${from} · nothing to pay now`, isCurrent: false };
    }
  }
}
