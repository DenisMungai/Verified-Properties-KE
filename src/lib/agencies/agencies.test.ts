import { describe, expect, it } from "vitest";
import { hashInviteToken, isWellFormedInviteToken, newInviteToken } from "./invite-token";
import { agencyFreeSlots, joinWarning, planJoin, type LiveListing } from "./join-plan";
import { AGENCY_SLUG_MAX, agencySlugBase, agencySlugCandidate } from "./slug";

const formatDate = (d: Date) => d.toISOString().slice(0, 10);

describe("agencySlugBase", () => {
  it("makes lower-case hyphenated ASCII words", () => {
    expect(agencySlugBase("Acme Réalty & Sons Ltd.")).toBe("acme-realty-sons-ltd");
    expect(agencySlugBase("  Nairobi   Homes  ")).toBe("nairobi-homes");
  });

  it("falls back to 'agency' when nothing usable is left", () => {
    expect(agencySlugBase("!!! ???")).toBe("agency");
    expect(agencySlugBase("🏠")).toBe("agency");
  });

  it("stops at a word boundary within the limit, or cuts one very long word", () => {
    const slug = agencySlugBase("Alpha ".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(AGENCY_SLUG_MAX);
    expect(slug.endsWith("-")).toBe(false);
    expect(agencySlugBase("x".repeat(90))).toHaveLength(AGENCY_SLUG_MAX);
  });

  it("matches the database slug format", () => {
    for (const name of ["Acme", "A-B--C", "  -Lead- ", "Ünïcödé Prop Ltd", "123 Realty"]) {
      expect(agencySlugBase(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("agencySlugCandidate", () => {
  it("adds -2, -3 … and stays within the limit", () => {
    expect(agencySlugCandidate("acme", 1)).toBe("acme");
    expect(agencySlugCandidate("acme", 3)).toBe("acme-3");
    const long = agencySlugCandidate("a".repeat(AGENCY_SLUG_MAX), 12);
    expect(long).toHaveLength(AGENCY_SLUG_MAX);
    expect(long.endsWith("-12")).toBe(true);
  });
});

describe("invite tokens", () => {
  it("issues a 43-character base64url token and stores only its SHA-256", () => {
    const { token, hash } = newInviteToken();
    expect(isWellFormedInviteToken(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
  });

  it("never issues the same token twice", () => {
    expect(newInviteToken().token).not.toBe(newInviteToken().token);
  });

  it("rejects malformed tokens before any lookup", () => {
    for (const bad of [undefined, "", "short", "a".repeat(44), "../../etc/passwd", `${"a".repeat(42)}=`]) {
      expect(isWellFormedInviteToken(bad)).toBe(false);
    }
  });
});

describe("agencyFreeSlots", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const active = { status: "active" as const, currentPeriodEnd: new Date("2026-12-01Z"), graceEndsAt: new Date("2026-12-04Z") };

  it("counts free places only on an active plan", () => {
    expect(agencyFreeSlots({ subscription: active, listingLimit: 10, activeListingCount: 7, now })).toBe(3);
    expect(agencyFreeSlots({ subscription: active, listingLimit: 5, activeListingCount: 9, now })).toBe(0);
  });

  it("has no places without a plan, while pending, in grace or lapsed", () => {
    expect(agencyFreeSlots({ subscription: null, listingLimit: null, activeListingCount: 0, now })).toBe(0);
    const pending = { status: "pending" as const, currentPeriodEnd: null, graceEndsAt: null };
    expect(agencyFreeSlots({ subscription: pending, listingLimit: 10, activeListingCount: 0, now })).toBe(0);
    const grace = { ...active, currentPeriodEnd: new Date("2026-11-14Z"), graceEndsAt: new Date("2026-11-17Z") };
    expect(agencyFreeSlots({ subscription: grace, listingLimit: 10, activeListingCount: 0, now })).toBe(0);
  });
});

describe("planJoin", () => {
  const listing = (id: string, status: LiveListing["status"], publishedAt: string | null): LiveListing => ({
    id,
    status,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
  });
  const live = [
    listing("old", "published", "2026-09-01Z"),
    listing("new", "published", "2026-11-01Z"),
    listing("mid", "published", "2026-10-01Z"),
    listing("review", "pending_review", null),
  ];

  it("keeps the newest published listings in the free places", () => {
    const plan = planJoin({ joinerLive: live, freeSlots: 2, personalPlan: null });
    expect(plan.keepIds.sort()).toEqual(["mid", "new"]);
    expect(plan.pauseIds).toEqual(["old"]);
    expect(plan.toDraftIds).toEqual(["review"]);
  });

  it("keeps everything when there is room", () => {
    const plan = planJoin({ joinerLive: live, freeSlots: 10, personalPlan: null });
    expect(plan.keepIds).toHaveLength(4);
    expect(plan.pauseIds).toEqual([]);
    expect(plan.toDraftIds).toEqual([]);
  });

  it("pauses every published listing when the agency has no places", () => {
    const plan = planJoin({ joinerLive: live, freeSlots: 0, personalPlan: { name: "Standard", paidUntil: null } });
    expect(plan.keepIds).toEqual([]);
    expect(plan.pauseIds.sort()).toEqual(["mid", "new", "old"]);
    expect(plan.cancelledPlan?.name).toBe("Standard");
  });
});

describe("joinWarning", () => {
  it("states listings, pauses and the cancelled plan with real numbers", () => {
    const plan = planJoin({
      joinerLive: [
        { id: "a", status: "published", publishedAt: new Date("2026-11-01Z") },
        { id: "b", status: "published", publishedAt: new Date("2026-10-01Z") },
      ],
      freeSlots: 1,
      personalPlan: { name: "Standard", paidUntil: new Date("2026-12-03Z") },
    });
    expect(joinWarning(plan, { agencyName: "Acme Realty", creating: false, formatDate })).toEqual([
      "You have 2 live listings. They will move to Acme Realty and use its listing plan (1 place free).",
      "1 listing will be paused because the agency's plan has no room for them.",
      "Your own Standard plan, paid until 2026-12-03, ends today. It isn't refunded.",
      "Your verification is not affected.",
    ]);
  });

  it("is short when there is nothing to lose", () => {
    const plan = planJoin({ joinerLive: [], freeSlots: 5, personalPlan: null });
    expect(joinWarning(plan, { agencyName: "Acme", creating: false, formatDate })).toEqual([
      "Your listings will move to Acme and use its listing plan.",
      "Your verification is not affected.",
    ]);
  });

  it("explains that a new agency's listings wait for its plan", () => {
    const plan = planJoin({
      joinerLive: [
        { id: "a", status: "published", publishedAt: new Date("2026-11-01Z") },
        { id: "r", status: "pending_review", publishedAt: null },
      ],
      freeSlots: 0,
      personalPlan: null,
    });
    const lines = joinWarning(plan, { agencyName: "Acme", creating: true, formatDate });
    expect(lines[0]).toContain("your new agency");
    expect(lines[1]).toBe(
      "1 listing will be paused and 1 listing waiting for review will go back to draft until the agency's plan is paid.",
    );
  });
});
