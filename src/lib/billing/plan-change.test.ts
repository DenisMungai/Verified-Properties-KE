import { describe, expect, it } from "vitest";
import { DAY_MS } from "./constants";
import {
  checkoutOption,
  classifyPlanChange,
  planChangeAtConfirmation,
  upgradeCreditDays,
  type PlanTerms,
  type SubscriptionState,
} from "./plan-change";

const at = (iso: string) => new Date(iso);
const STARTER: PlanTerms = { id: "p-starter", code: "starter", name: "Starter", priceKes: 1000, listingLimit: 3 };
const PRO: PlanTerms = { id: "p-pro", code: "pro", name: "Pro", priceKes: 3000, listingLimit: 20 };

const END = at("2026-12-01T00:00:00Z");
function sub(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    planId: STARTER.id,
    status: "active",
    currentPeriodStart: at("2026-11-01T00:00:00Z"),
    currentPeriodEnd: END,
    graceEndsAt: at("2026-12-04T00:00:00Z"),
    scheduledPlanId: null,
    scheduledChangeAt: null,
    ...overrides,
  };
}
const MID = at("2026-11-16T00:00:00Z"); // 15 days before END
const GRACE = at("2026-12-02T00:00:00Z");
const LAPSED = at("2026-12-10T00:00:00Z");

describe("classifyPlanChange", () => {
  const classify = (s: SubscriptionState | null, target: PlanTerms, now = MID, plan = STARTER) =>
    classifyPlanChange({ current: s ? { subscription: s, plan } : null, target, now });

  it("covers every row of the decision table", () => {
    expect(classify(null, PRO)).toBe("new");
    expect(classify(sub({ status: "pending", currentPeriodStart: null, currentPeriodEnd: null, graceEndsAt: null }), STARTER)).toBe("new");
    expect(classify(sub({ status: "pending", currentPeriodStart: null, currentPeriodEnd: null, graceEndsAt: null }), PRO)).toBe(
      "switch_unpaid",
    );
    expect(classify(sub(), STARTER)).toBe("renew");
    expect(classify(sub(), PRO)).toBe("upgrade");
    expect(classify(sub({ planId: PRO.id }), STARTER, MID, PRO)).toBe("downgrade");
    expect(classify(sub(), PRO, GRACE)).toBe("upgrade");
    expect(classify(sub(), PRO, LAPSED)).toBe("restart");
    expect(classify(sub(), STARTER, LAPSED)).toBe("restart");
    expect(classify(sub({ status: "paused" }), STARTER)).toBe("restart");
  });

  it("treats the scheduled plan as a renewal", () => {
    const scheduled = sub({ planId: PRO.id, scheduledPlanId: STARTER.id, scheduledChangeAt: END });
    expect(classify(scheduled, STARTER, MID, PRO)).toBe("renew");
    expect(classify(scheduled, PRO, MID, PRO)).toBe("renew");
  });
});

describe("upgradeCreditDays", () => {
  it("credits unused days at the paid price, converted at the new price", () => {
    expect(upgradeCreditDays({ now: MID, currentPeriodEnd: END, paidAmountKes: 1000, newPriceKes: 3000 })).toBe(5);
  });

  it("floors once, at the end", () => {
    const now = new Date(END.getTime() - 14.5 * DAY_MS);
    // 14.5 days × 1000 / 3000 = 4.83 → 4
    expect(upgradeCreditDays({ now, currentPeriodEnd: END, paidAmountKes: 1000, newPriceKes: 3000 })).toBe(4);
  });

  it("is 0 when nothing is left or the inputs are unknown", () => {
    expect(upgradeCreditDays({ now: GRACE, currentPeriodEnd: END, paidAmountKes: 1000, newPriceKes: 3000 })).toBe(0);
    expect(upgradeCreditDays({ now: MID, currentPeriodEnd: null, paidAmountKes: 1000, newPriceKes: 3000 })).toBe(0);
    expect(upgradeCreditDays({ now: MID, currentPeriodEnd: END, paidAmountKes: null, newPriceKes: 3000 })).toBe(0);
    expect(upgradeCreditDays({ now: MID, currentPeriodEnd: END, paidAmountKes: 1000, newPriceKes: 0 })).toBe(0);
  });
});

describe("planChangeAtConfirmation", () => {
  const confirm = (s: SubscriptionState, invoicePlan: PlanTerms, confirmedAt: Date, currentPlan = STARTER) =>
    planChangeAtConfirmation({ subscription: s, currentPlan, invoicePlan, confirmedAt, coveringPaidAmountKes: 1000 });

  it("renews the same plan by stacking on the period end and keeps the period start", () => {
    const change = confirm(sub(), STARTER, MID);
    expect(change).toMatchObject({ kind: "renew", planId: STARTER.id, periodStart: END, creditDays: 0 });
    expect(change.periodEnd).toEqual(at("2026-12-31T00:00:00Z"));
    expect(change.currentPeriodStart).toEqual(at("2026-11-01T00:00:00Z"));
  });

  it("drops a scheduled downgrade when the current plan is paid again", () => {
    const change = confirm(sub({ planId: PRO.id, scheduledPlanId: STARTER.id, scheduledChangeAt: END }), PRO, MID, PRO);
    expect(change).toMatchObject({ kind: "renew", planId: PRO.id, scheduledPlanId: null, scheduledChangeAt: null });
  });

  it("upgrades now with credited days: 15 days of KES 1,000 buy 5 days of KES 3,000", () => {
    const change = confirm(sub({ scheduledPlanId: null }), PRO, MID);
    expect(change).toMatchObject({ kind: "upgrade", planId: PRO.id, periodStart: MID, currentPeriodStart: MID, creditDays: 5 });
    expect(change.periodEnd.getTime() - MID.getTime()).toBe(35 * DAY_MS);
    expect(change.graceEndsAt.getTime() - change.periodEnd.getTime()).toBe(3 * DAY_MS);
  });

  it("upgrades in grace without credit", () => {
    expect(confirm(sub(), PRO, GRACE)).toMatchObject({ kind: "upgrade", periodStart: GRACE, creditDays: 0 });
  });

  it("keeps a scheduled downgrade waiting when renewed early, and switches once the date has passed", () => {
    const scheduled = sub({ planId: PRO.id, scheduledPlanId: STARTER.id, scheduledChangeAt: END });
    expect(confirm(scheduled, STARTER, MID, PRO)).toMatchObject({
      kind: "scheduled_renew",
      planId: PRO.id,
      scheduledPlanId: STARTER.id,
      scheduledChangeAt: END,
      periodStart: END,
    });
    expect(confirm(scheduled, STARTER, GRACE, PRO)).toMatchObject({
      kind: "scheduled_renew",
      planId: STARTER.id,
      scheduledPlanId: null,
      periodStart: GRACE,
    });
  });

  it("schedules a lower plan paid while the current one runs (stale Paybill invoice)", () => {
    expect(confirm(sub({ planId: PRO.id }), STARTER, MID, PRO)).toMatchObject({
      kind: "scheduled_renew",
      planId: PRO.id,
      scheduledPlanId: STARTER.id,
      scheduledChangeAt: END,
    });
  });

  it("restarts a lapsed subscription on any other plan, fresh and without credit", () => {
    const change = confirm(sub({ status: "paused" }), PRO, LAPSED);
    expect(change).toMatchObject({ kind: "restart", planId: PRO.id, periodStart: LAPSED, creditDays: 0 });
    expect(change.periodEnd.getTime() - LAPSED.getTime()).toBe(30 * DAY_MS);
  });

  it("starts a lapsed same-plan renewal fresh from the payment", () => {
    const change = confirm(sub({ status: "past_due" }), STARTER, LAPSED);
    expect(change).toMatchObject({ kind: "renew", periodStart: LAPSED, currentPeriodStart: LAPSED });
  });
});

describe("checkoutOption", () => {
  const option = (s: SubscriptionState | null, target: PlanTerms, plan = STARTER) =>
    checkoutOption({ current: s ? { subscription: s, plan } : null, target, now: MID, coveringPaidAmountKes: 1000 });

  it("describes each outcome in one line", () => {
    expect(option(null, STARTER)).toEqual({ kind: "new", payKes: 1000, line: "30 days from when you pay", isCurrent: false });
    expect(option(sub(), STARTER)).toMatchObject({ kind: "renew", payKes: 1000, line: "Adds 30 days from 1 Dec 2026", isCurrent: true });
    expect(option(sub(), PRO)).toMatchObject({ payKes: 3000, line: "Starts now · about 5 extra days from your current plan" });
    expect(option(sub({ planId: PRO.id }), STARTER, PRO)).toEqual({
      kind: "downgrade",
      payKes: 0,
      line: "Starts 1 Dec 2026 · nothing to pay now",
      isCurrent: false,
    });
  });
});
