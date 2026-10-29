import { describe, expect, it } from "vitest";
import { DAY_MS } from "./constants";
import { graceEndsAt, nextPeriod, subscriptionPhase, type SubscriptionTiming } from "./periods";

const at = (iso: string) => new Date(iso);

describe("nextPeriod", () => {
  it("starts at confirmation for a new or lapsed subscription", () => {
    const confirmedAt = at("2026-11-01T09:00:00Z");
    expect(nextPeriod({ confirmedAt, currentPeriodEnd: null })).toEqual({
      start: confirmedAt,
      end: at("2026-12-01T09:00:00Z"),
      graceEndsAt: at("2026-12-04T09:00:00Z"),
    });
    const lapsed = nextPeriod({ confirmedAt, currentPeriodEnd: at("2026-10-20T00:00:00Z") });
    expect(lapsed.start).toEqual(confirmedAt);
  });

  it("extends from the current period end when renewing early", () => {
    const period = nextPeriod({
      confirmedAt: at("2026-11-25T09:00:00Z"),
      currentPeriodEnd: at("2026-12-01T09:00:00Z"),
    });
    expect(period.start).toEqual(at("2026-12-01T09:00:00Z"));
    expect(period.end).toEqual(at("2026-12-31T09:00:00Z"));
  });

  it("gives exactly 3 days of grace", () => {
    const end = at("2026-12-01T00:00:00Z");
    expect(graceEndsAt(end).getTime() - end.getTime()).toBe(3 * DAY_MS);
  });
});

describe("subscriptionPhase", () => {
  const paid: SubscriptionTiming = {
    status: "active",
    currentPeriodEnd: at("2026-12-01T00:00:00Z"),
    graceEndsAt: at("2026-12-04T00:00:00Z"),
  };

  it("is active before the period end", () => {
    expect(subscriptionPhase(paid, at("2026-11-30T23:59:59Z"))).toBe("active");
  });

  it("enters grace exactly at the period end", () => {
    expect(subscriptionPhase(paid, at("2026-12-01T00:00:00Z"))).toBe("grace");
    expect(subscriptionPhase({ ...paid, status: "past_due" }, at("2026-12-03T23:59:59Z"))).toBe("grace");
  });

  it("lapses exactly at the grace end, whatever the status says", () => {
    expect(subscriptionPhase(paid, at("2026-12-04T00:00:00Z"))).toBe("lapsed");
  });

  it("treats paused, cancelled and expired as lapsed", () => {
    for (const status of ["paused", "cancelled", "expired"] as const) {
      expect(subscriptionPhase({ ...paid, status }, at("2026-11-15T00:00:00Z"))).toBe("lapsed");
    }
  });

  it("is pending until paid, and lapsed when a paid status has no period", () => {
    expect(
      subscriptionPhase({ status: "pending", currentPeriodEnd: null, graceEndsAt: null }, at("2026-11-15T00:00:00Z")),
    ).toBe("pending");
    expect(
      subscriptionPhase({ status: "active", currentPeriodEnd: null, graceEndsAt: null }, at("2026-11-15T00:00:00Z")),
    ).toBe("lapsed");
  });
});
