import { describe, expect, it } from "vitest";
import { canPublish, pickListingsToKeep, PUBLISH_BLOCK_MESSAGES, remainingSlots } from "./entitlements";
import type { SubscriptionTiming } from "./periods";

const now = new Date("2026-11-15T12:00:00Z");
const active: SubscriptionTiming = {
  status: "active",
  currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
  graceEndsAt: new Date("2026-12-04T00:00:00Z"),
};

describe("canPublish", () => {
  it("allows publishing below the limit", () => {
    expect(canPublish({ subscription: active, listingLimit: 3, activeListingCount: 2, now })).toEqual({
      ok: true,
      limit: 3,
      activeListingCount: 2,
      remaining: 1,
    });
  });

  it("blocks at the limit", () => {
    const result = canPublish({ subscription: active, listingLimit: 3, activeListingCount: 3, now });
    expect(result).toMatchObject({ ok: false, reason: "limit_reached", limit: 3 });
  });

  it("blocks without a plan", () => {
    expect(canPublish({ subscription: null, listingLimit: null, activeListingCount: 0, now })).toMatchObject({
      ok: false,
      reason: "no_plan",
    });
  });

  it("blocks while payment is pending", () => {
    const pending: SubscriptionTiming = { status: "pending", currentPeriodEnd: null, graceEndsAt: null };
    expect(canPublish({ subscription: pending, listingLimit: 3, activeListingCount: 0, now })).toMatchObject({
      ok: false,
      reason: "plan_pending",
    });
  });

  it("blocks new publishing during grace", () => {
    const inGrace = new Date("2026-12-02T00:00:00Z");
    expect(canPublish({ subscription: active, listingLimit: 3, activeListingCount: 0, now: inGrace })).toMatchObject({
      ok: false,
      reason: "plan_in_grace",
    });
  });

  it("blocks after grace and for stopped subscriptions", () => {
    const afterGrace = new Date("2026-12-04T00:00:00Z");
    expect(canPublish({ subscription: active, listingLimit: 3, activeListingCount: 0, now: afterGrace })).toMatchObject({
      ok: false,
      reason: "plan_lapsed",
    });
    const cancelled = { ...active, status: "cancelled" as const };
    expect(canPublish({ subscription: cancelled, listingLimit: 3, activeListingCount: 0, now })).toMatchObject({
      ok: false,
      reason: "plan_lapsed",
    });
  });

  it("has a plain message for every reason", () => {
    for (const message of Object.values(PUBLISH_BLOCK_MESSAGES)) expect(message.length).toBeGreaterThan(10);
  });
});

describe("remainingSlots", () => {
  it("never goes below zero", () => {
    expect(remainingSlots(20, 5)).toBe(15);
    expect(remainingSlots(3, 7)).toBe(0);
  });
});

describe("pickListingsToKeep", () => {
  const listing = (id: string, publishedAt: string | null) => ({
    id,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
  });

  it("keeps the newest published listings up to the limit", () => {
    const kept = pickListingsToKeep(
      [
        listing("a", "2026-10-01T00:00:00Z"),
        listing("b", "2026-11-01T00:00:00Z"),
        listing("c", null),
        listing("d", "2026-10-15T00:00:00Z"),
      ],
      2,
    );
    expect(kept.map((l) => l.id)).toEqual(["b", "d"]);
  });

  it("breaks ties by id and puts never-published listings last", () => {
    const same = "2026-10-01T00:00:00Z";
    const kept = pickListingsToKeep([listing("z", null), listing("y", same), listing("x", same)], 3);
    expect(kept.map((l) => l.id)).toEqual(["x", "y", "z"]);
  });

  it("keeps nothing for a zero limit and does not mutate the input", () => {
    const input = [listing("a", "2026-10-01T00:00:00Z")];
    expect(pickListingsToKeep(input, 0)).toEqual([]);
    expect(pickListingsToKeep(input, 5)).toEqual(input);
    expect(input[0].id).toBe("a");
  });
});
