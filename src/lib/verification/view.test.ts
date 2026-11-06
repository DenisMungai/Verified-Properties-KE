import { describe, expect, it } from "vitest";
import { listerView, viewBadge, viewShortLine, viewSummary, type LatestRequestFacts } from "./view";

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
    expect(view(facts("documents_pending"))).toEqual({ state: "upload", changesReason: null, currentEndsAt: null });
    expect(view(facts("documents_pending", { decisionReason: "Blurred ID" }))).toEqual({
      state: "upload",
      changesReason: "Blurred ID",
      currentEndsAt: null,
    });
  });

  it("is verified only while the review is unexpired", () => {
    expect(view(facts("verified", { reviewExpiresAt: later }), { badgeLive: true })).toEqual({
      state: "verified",
      expiresAt: later,
      badgeLive: true,
      canRereview: false,
    });
    // S13: a review past its date reads as ended even before the daily job records it.
    expect(view(facts("verified", { reviewExpiresAt: earlier }))).toEqual({
      state: "expired",
      endedAt: earlier,
      canRereview: false,
      listingPlanOk: true,
    });
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

describe("listerView re-review states (S13 decision 10)", () => {
  const approved = { status: "verified" as const, reviewExpiresAt: later };
  const rereviewOf = (status: LatestRequestFacts["status"], more: Partial<LatestRequestFacts> = {}) =>
    facts(status, { renewsRequestId: "11111111-1111-1111-1111-111111111111", ...more });
  const withApproved = (latest: LatestRequestFacts, canRereview = false) =>
    listerView({ latest, listingPlanOk: true, badgeLive: true, credit: null, now, lastApproved: approved, canRereview });

  it("offers a re-review on a verified review inside the window", () => {
    const v = withApproved(facts("verified", { reviewExpiresAt: later }), true);
    expect(v).toMatchObject({ state: "verified", canRereview: true });
    expect(viewShortLine(v)).toMatch(/^Re-review due by /);
  });

  it("keeps the current badge note while a re-review runs", () => {
    expect(withApproved(rereviewOf("documents_pending"))).toEqual({ state: "upload", changesReason: null, currentEndsAt: later });
    expect(withApproved(rereviewOf("under_review"))).toEqual({ state: "under_review", submittedAt: null, currentEndsAt: later });
    expect(viewSummary(withApproved(rereviewOf("documents_pending")))).toMatch(/Your badge stays until/);
  });

  it("shows an expired review with its end date", () => {
    const v = listerView({
      latest: facts("expired", { reviewExpiresAt: earlier, endedAt: earlier }),
      listingPlanOk: true,
      badgeLive: false,
      credit: null,
      now,
      canRereview: true,
    });
    expect(v).toEqual({ state: "expired", endedAt: earlier, canRereview: true, listingPlanOk: true });
    expect(viewBadge(v)).toEqual({ label: "Review ended", tone: "neutral" });
  });

  it("marks a declined re-review apart from a first-time rejection", () => {
    const v = withApproved(rereviewOf("rejected", { decisionReason: "Expired EARB certificate" }));
    expect(v).toMatchObject({ state: "rejected", rereview: true, currentEndsAt: later });
    expect(viewBadge(v).label).toBe("Re-review not approved");
    const first = view(facts("rejected"));
    expect(first).toMatchObject({ state: "rejected", rereview: false, currentEndsAt: null });
    expect(viewBadge(first).label).toBe("Not approved");
  });

  it("never promises a badge date that has passed", () => {
    const ended = listerView({
      latest: rereviewOf("rejected"),
      listingPlanOk: true,
      badgeLive: false,
      credit: null,
      now,
      lastApproved: { status: "verified", reviewExpiresAt: earlier },
      canRereview: true,
    });
    expect(ended).toMatchObject({ state: "rejected", rereview: true, currentEndsAt: null });
    expect(viewSummary(ended)).toBe("Your re-review wasn't approved. See why, and try again when ready.");
  });
});
