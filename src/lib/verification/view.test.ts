import { describe, expect, it } from "vitest";
import { listerView, viewBadge, type LatestRequestFacts } from "./view";

const now = new Date("2026-11-06T10:00:00Z");
const later = new Date("2027-11-06T10:00:00Z");
const earlier = new Date("2026-01-01T00:00:00Z");

function view(latest: LatestRequestFacts | null, extra: { listingPlanOk?: boolean; badgeLive?: boolean } = {}) {
  return listerView({ latest, listingPlanOk: extra.listingPlanOk ?? true, badgeLive: extra.badgeLive ?? false, credit: null, now });
}

const facts = (status: LatestRequestFacts["status"], more: Partial<LatestRequestFacts> = {}): LatestRequestFacts => ({
  status,
  decisionReason: null,
  submittedAt: null,
  reviewExpiresAt: null,
  ...more,
});

describe("listerView (S12 decision 10)", () => {
  it("starts with no request", () => {
    expect(view(null)).toEqual({ state: "not_started", listingPlanOk: true, reapply: false });
  });

  it("shows the upload step, with the admin's reason after changes are requested", () => {
    expect(view(facts("documents_pending"))).toEqual({ state: "upload", changesReason: null });
    expect(view(facts("documents_pending", { decisionReason: "Blurred ID" }))).toEqual({ state: "upload", changesReason: "Blurred ID" });
  });

  it("is verified only while the review is unexpired", () => {
    expect(view(facts("verified", { reviewExpiresAt: later }), { badgeLive: true })).toEqual({ state: "verified", expiresAt: later, badgeLive: true });
    expect(view(facts("verified", { reviewExpiresAt: earlier }))).toEqual({ state: "not_started", listingPlanOk: true, reapply: true });
  });

  it("separates a live badge from a paused one", () => {
    const paused = view(facts("verified", { reviewExpiresAt: later }), { badgeLive: false });
    expect(viewBadge(paused)).toEqual({ label: "Badge paused", tone: "warning" });
    const live = view(facts("verified", { reviewExpiresAt: later }), { badgeLive: true });
    expect(viewBadge(live)).toEqual({ label: "Profile verified", tone: "verified" });
  });

  it("covers rejected, suspended and expired", () => {
    expect(view(facts("rejected", { decisionReason: "No match" })).state).toBe("rejected");
    expect(view(facts("suspended")).state).toBe("suspended");
    expect(view(facts("expired"))).toEqual({ state: "not_started", listingPlanOk: true, reapply: true });
  });

  it("never labels anyone verified before approval", () => {
    for (const status of ["payment_pending", "documents_pending", "under_review", "rejected", "suspended"] as const) {
      expect(viewBadge(view(facts(status))).label).not.toBe("Profile verified");
    }
  });
});
