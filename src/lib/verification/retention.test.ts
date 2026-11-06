import { describe, expect, it } from "vitest";
import { isPurgeDue, purgeDueAt } from "./retention";
import { VERIFICATION_STATUSES } from "./rules";

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-01-15T09:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

describe("document retention (S13 decision 7)", () => {
  it("keeps expired reviews 90 days from when they ended", () => {
    const facts = { status: "expired" as const, decidedAt: at(-400), endedAt: t0 };
    expect(isPurgeDue(facts, at(89.99))).toBe(false);
    expect(isPurgeDue(facts, at(90))).toBe(true);
  });

  it("keeps rejected requests 90 days from the decision", () => {
    const facts = { status: "rejected" as const, decidedAt: t0, endedAt: null };
    expect(isPurgeDue(facts, at(89))).toBe(false);
    expect(isPurgeDue(facts, at(90))).toBe(true);
  });

  it("keeps suspended requests 24 months", () => {
    const facts = { status: "suspended" as const, decidedAt: t0, endedAt: null };
    expect(purgeDueAt(facts)).toEqual(new Date("2028-01-15T09:00:00Z"));
    expect(isPurgeDue(facts, new Date("2027-12-15T09:00:00Z"))).toBe(false);
    expect(isPurgeDue(facts, new Date("2028-01-15T09:00:00Z"))).toBe(true);
  });

  it("never purges open or verified requests, or one with no clock", () => {
    for (const status of VERIFICATION_STATUSES.filter((s) => !["expired", "rejected", "suspended"].includes(s))) {
      expect(purgeDueAt({ status, decidedAt: at(-10_000), endedAt: at(-10_000) })).toBeNull();
    }
    expect(purgeDueAt({ status: "expired", decidedAt: t0, endedAt: null })).toBeNull();
  });
});
