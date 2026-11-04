import { describe, expect, it } from "vitest";
import { DAY_MS } from "./constants";
import { canReceiveCredit, creditDaysFromPayment, extendPeriodByDays } from "./credit";

const now = new Date("2026-11-04T09:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * DAY_MS);

describe("creditDaysFromPayment", () => {
  it("gives 30 days per plan price, rounded down", () => {
    expect(creditDaysFromPayment(1000, 1000)).toBe(30);
    expect(creditDaysFromPayment(500, 1000)).toBe(15);
    expect(creditDaysFromPayment(999, 3000)).toBe(9);
    expect(creditDaysFromPayment(2000, 1000)).toBe(60);
  });

  it("returns 0 when nothing can be credited", () => {
    expect(creditDaysFromPayment(10, 1000)).toBe(0);
    expect(creditDaysFromPayment(0, 1000)).toBe(0);
    expect(creditDaysFromPayment(1000, 0)).toBe(0);
    expect(creditDaysFromPayment(10.5, 10)).toBe(0);
  });

  it("caps at the audit log's 365 days", () => {
    expect(creditDaysFromPayment(1_000_000, 100)).toBe(365);
  });
});

describe("canReceiveCredit", () => {
  it("allows active and in-grace paid subscriptions", () => {
    expect(canReceiveCredit({ status: "active", currentPeriodEnd: days(10), graceEndsAt: days(13) }, now)).toBe(true);
    expect(canReceiveCredit({ status: "active", currentPeriodEnd: days(-1), graceEndsAt: days(2) }, now)).toBe(true);
  });

  it("refuses lapsed, paused, pending and cancelled subscriptions", () => {
    expect(canReceiveCredit({ status: "active", currentPeriodEnd: days(-5), graceEndsAt: days(-2) }, now)).toBe(false);
    expect(canReceiveCredit({ status: "paused", currentPeriodEnd: days(-5), graceEndsAt: days(-2) }, now)).toBe(false);
    expect(canReceiveCredit({ status: "pending", currentPeriodEnd: null, graceEndsAt: null }, now)).toBe(false);
    expect(canReceiveCredit({ status: "cancelled", currentPeriodEnd: days(10), graceEndsAt: days(13) }, now)).toBe(false);
  });
});

describe("extendPeriodByDays", () => {
  it("adds days to the paid end and recomputes grace", () => {
    const out = extendPeriodByDays({ status: "active", currentPeriodEnd: days(10), scheduledChangeAt: null }, 5, now);
    expect(out.currentPeriodEnd).toEqual(days(15));
    expect(out.graceEndsAt).toEqual(days(18));
    expect(out.status).toBe("active");
    expect(out.scheduledChangeAt).toBeNull();
  });

  it("moves a downgrade scheduled for the old period end", () => {
    const out = extendPeriodByDays({ status: "active", currentPeriodEnd: days(10), scheduledChangeAt: days(10) }, 5, now);
    expect(out.scheduledChangeAt).toEqual(days(15));
  });

  it("leaves a schedule on another date alone", () => {
    const out = extendPeriodByDays({ status: "active", currentPeriodEnd: days(10), scheduledChangeAt: days(4) }, 5, now);
    expect(out.scheduledChangeAt).toEqual(days(4));
  });

  it("returns past_due to active once the new end is in the future", () => {
    expect(extendPeriodByDays({ status: "past_due", currentPeriodEnd: days(-1), scheduledChangeAt: null }, 3, now).status).toBe("active");
    expect(extendPeriodByDays({ status: "past_due", currentPeriodEnd: days(-2), scheduledChangeAt: null }, 1, now).status).toBe("past_due");
  });
});
