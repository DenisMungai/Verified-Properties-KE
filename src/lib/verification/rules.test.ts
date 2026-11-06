import { describe, expect, it } from "vitest";
import {
  canStartRereview,
  canTransition,
  rereviewReminderDue,
  type RereviewFacts,
  missingDocumentTypes,
  requestNumber,
  requiredDocumentTypes,
  reviewExpiresAt,
  sanitizeFileName,
  VERIFICATION_STATUSES,
  workingDaysBetween,
  type VerificationStatus,
} from "./rules";

describe("requiredDocumentTypes (S12 decision 1)", () => {
  it("asks owners for an ID only", () => {
    expect(requiredDocumentTypes("owner", false)).toEqual(["national_id"]);
  });
  it("adds EARB for agents", () => {
    expect(requiredDocumentTypes("agent", false)).toEqual(["national_id", "earb_certificate"]);
  });
  it("adds business registration for developers", () => {
    expect(requiredDocumentTypes("developer", false)).toEqual(["national_id", "business_registration"]);
  });
  it("adds business registration for anyone in an agency", () => {
    expect(requiredDocumentTypes("agent", true)).toEqual(["national_id", "earb_certificate", "business_registration"]);
    expect(requiredDocumentTypes("owner", true)).toEqual(["national_id", "business_registration"]);
    expect(requiredDocumentTypes("developer", true)).toEqual(["national_id", "business_registration"]);
  });
  it("never asks for a KRA PIN", () => {
    for (const type of ["agent", "owner", "developer"] as const) {
      for (const inAgency of [false, true]) expect(requiredDocumentTypes(type, inAgency).join()).not.toMatch(/kra/i);
    }
  });
});

describe("missingDocumentTypes", () => {
  it("lists required types with no file, in order", () => {
    expect(missingDocumentTypes(["national_id", "earb_certificate"], ["earb_certificate"])).toEqual(["national_id"]);
    expect(missingDocumentTypes(["national_id"], ["national_id", "national_id"])).toEqual([]);
  });
});

describe("canTransition (S12 decision 2)", () => {
  const allowed: [VerificationStatus, VerificationStatus][] = [
    ["payment_pending", "documents_pending"],
    ["documents_pending", "under_review"],
    // S13 decision 6: only a suspension closing an open re-review.
    ["documents_pending", "rejected"],
    ["under_review", "verified"],
    ["under_review", "documents_pending"],
    ["under_review", "rejected"],
    ["verified", "suspended"],
    ["verified", "expired"],
  ];

  it("allows exactly the documented edges", () => {
    for (const from of VERIFICATION_STATUSES) {
      for (const to of VERIFICATION_STATUSES) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("never lets payment alone reach verified", () => {
    expect(canTransition("payment_pending", "verified")).toBe(false);
    expect(canTransition("documents_pending", "verified")).toBe(false);
  });
});

describe("reviewExpiresAt", () => {
  it("is 12 months after the decision", () => {
    expect(reviewExpiresAt(new Date("2026-11-06T10:00:00Z")).toISOString()).toBe("2027-11-06T10:00:00.000Z");
  });
});

describe("requestNumber", () => {
  it("is VR- plus the first 6 hex characters, upper-cased", () => {
    expect(requestNumber("3f9a1c22-0000-4000-8000-000000000000")).toBe("VR-3F9A1C");
  });
});

describe("sanitizeFileName", () => {
  it("keeps a plain name", () => {
    expect(sanitizeFileName("national-id_front.pdf")).toBe("national-id_front.pdf");
  });
  it("drops paths, markup and odd characters", () => {
    expect(sanitizeFileName("C:\\Users\\me\\<script>id.pdf")).toBe("script_id.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
  });
  it("caps the length and never returns empty", () => {
    expect(sanitizeFileName("a".repeat(300) + ".pdf").length).toBe(120);
    expect(sanitizeFileName("???")).toBe("document");
    expect(sanitizeFileName("")).toBe("document");
  });
});

describe("workingDaysBetween", () => {
  it("counts weekdays only", () => {
    // Friday 6 Nov 2026 09:00 Nairobi → Tuesday 10 Nov 2026 09:00 Nairobi: Fri, Mon = 2.
    expect(workingDaysBetween(new Date("2026-11-06T06:00:00Z"), new Date("2026-11-10T06:00:00Z"))).toBe(2);
    expect(workingDaysBetween(new Date("2026-11-07T06:00:00Z"), new Date("2026-11-09T06:00:00Z"))).toBe(0);
  });
});

describe("canStartRereview (S13 decision 3)", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
  const ok: RereviewFacts = {
    lastApproved: { status: "verified", reviewExpiresAt: inDays(30) },
    hasOpenRequest: false,
    latestStatus: "verified",
    verificationPlanOk: true,
    listingPlanOk: true,
  };

  it("opens 30 days before the review ends, and any time after", () => {
    expect(canStartRereview(ok, now)).toEqual({ ok: true });
    expect(canStartRereview({ ...ok, lastApproved: { status: "verified", reviewExpiresAt: inDays(1) } }, now)).toEqual({ ok: true });
    expect(
      canStartRereview({ ...ok, lastApproved: { status: "expired", reviewExpiresAt: inDays(-90) }, latestStatus: "expired" }, now),
    ).toEqual({ ok: true });
  });
  it("is too early at 31 days", () => {
    expect(canStartRereview({ ...ok, lastApproved: { status: "verified", reviewExpiresAt: inDays(31) } }, now)).toEqual({
      ok: false,
      code: "too_early",
    });
  });
  it("needs an approved review", () => {
    expect(canStartRereview({ ...ok, lastApproved: null }, now)).toEqual({ ok: false, code: "no_approved_review" });
  });
  it("refuses with an open request, when suspended, or with a plan out of good standing", () => {
    expect(canStartRereview({ ...ok, hasOpenRequest: true }, now)).toEqual({ ok: false, code: "request_open" });
    expect(canStartRereview({ ...ok, latestStatus: "suspended" }, now)).toEqual({ ok: false, code: "suspended" });
    expect(canStartRereview({ ...ok, verificationPlanOk: false }, now)).toEqual({ ok: false, code: "verification_plan_inactive" });
    expect(canStartRereview({ ...ok, listingPlanOk: false }, now)).toEqual({ ok: false, code: "listing_plan_inactive" });
  });
});

describe("rereviewReminderDue (S13 decision 7)", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  const at = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  it("sends 30d while more than 7 days are left, 7d inside the last 7", () => {
    expect(rereviewReminderDue(at(31), now)).toBeNull();
    expect(rereviewReminderDue(at(30), now)).toBe("30d");
    expect(rereviewReminderDue(at(7.01), now)).toBe("30d");
    expect(rereviewReminderDue(at(7), now)).toBe("7d");
    expect(rereviewReminderDue(at(0.01), now)).toBe("7d");
  });
  it("sends nothing once the review has ended", () => {
    expect(rereviewReminderDue(at(0), now)).toBeNull();
    expect(rereviewReminderDue(at(-1), now)).toBeNull();
  });
});
