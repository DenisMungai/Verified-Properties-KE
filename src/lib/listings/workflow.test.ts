import { describe, expect, it } from "vitest";
import { listingStatus } from "@/db/schema";
import {
  LISTING_STATUSES,
  STATUS_LABELS,
  canDeleteDraft,
  canSubmit,
  isEditableByLister,
  isMaterialEdit,
  listerCanTransition,
  statusAfterEdit,
  type ListingStatus,
} from "./workflow";

const sale = { listingType: "sale" as const };
const rent = { listingType: "rent" as const };

describe("listing statuses", () => {
  it("match the database enum and all have labels", () => {
    expect([...LISTING_STATUSES]).toEqual(listingStatus.enumValues);
    for (const status of LISTING_STATUSES) expect(STATUS_LABELS[status]).toBeTruthy();
  });
});

describe("listerCanTransition", () => {
  it("lets published sale listings be sold but not rented, and the reverse for rent", () => {
    expect(listerCanTransition("published", "sold", sale)).toBe(true);
    expect(listerCanTransition("published", "rented", sale)).toBe(false);
    expect(listerCanTransition("published", "rented", rent)).toBe(true);
    expect(listerCanTransition("published", "sold", rent)).toBe(false);
  });

  it("allows withdrawing a submission and archiving finished listings", () => {
    expect(listerCanTransition("pending_review", "draft", sale)).toBe(true);
    for (const from of ["rented", "sold", "withdrawn", "paused", "published", "rejected", "draft"] as const) {
      expect(listerCanTransition(from, "archived", sale)).toBe(true);
    }
  });

  it("never lets a lister publish, approve, pause or leave archived", () => {
    const all = LISTING_STATUSES;
    for (const from of all) {
      expect(listerCanTransition(from, "published", sale)).toBe(false);
      expect(listerCanTransition(from, "pending_review", sale)).toBe(false);
      expect(listerCanTransition(from, "paused", sale)).toBe(false);
      expect(listerCanTransition(from, "rejected", sale)).toBe(false);
    }
    for (const to of all) expect(listerCanTransition("archived", to, sale)).toBe(false);
  });

  it("does not let sold, rented or withdrawn listings go back to draft", () => {
    for (const from of ["rented", "sold", "withdrawn"] as const) {
      expect(listerCanTransition(from, "draft", rent)).toBe(false);
    }
  });
});

describe("submit, edit and delete rules", () => {
  it("submits only drafts and rejected listings", () => {
    const allowed = LISTING_STATUSES.filter(canSubmit);
    expect(allowed).toEqual(["draft", "rejected"]);
  });

  it("edits only live or in-progress listings", () => {
    const editable = LISTING_STATUSES.filter(isEditableByLister);
    expect(editable.sort()).toEqual(["draft", "paused", "pending_review", "published", "rejected"]);
  });

  it("deletes only never-submitted drafts", () => {
    expect(canDeleteDraft({ status: "draft", publishedAt: null, reviewedAt: null })).toBe(true);
    expect(canDeleteDraft({ status: "draft", publishedAt: new Date(), reviewedAt: null })).toBe(false);
    expect(canDeleteDraft({ status: "draft", publishedAt: null, reviewedAt: new Date() })).toBe(false);
    expect(canDeleteDraft({ status: "pending_review", publishedAt: null, reviewedAt: null })).toBe(false);
  });
});

describe("material edits", () => {
  const base = {
    title: "Two bedroom apartment in Kilimani",
    description: "Bright and airy",
    category: "apartment",
    listingType: "rent",
    county: "Nairobi",
    town: "Nairobi",
    neighbourhood: "Kilimani",
  };

  it("treats title, description, category, type and location as material", () => {
    expect(isMaterialEdit(base, { ...base, title: "Three bedroom apartment" })).toBe(true);
    expect(isMaterialEdit(base, { ...base, neighbourhood: null })).toBe(true);
    expect(isMaterialEdit(base, { ...base })).toBe(false);
  });

  it("sends an unverified owner's live or paused listing back through review only on material edits", () => {
    const cases: Array<[ListingStatus, boolean, boolean, ListingStatus]> = [
      ["published", true, false, "pending_review"],
      ["published", false, false, "published"],
      ["published", true, true, "published"],
      ["draft", true, false, "draft"],
      ["paused", true, false, "draft"],
      ["paused", false, false, "paused"],
      ["paused", true, true, "paused"],
      ["rejected", true, false, "rejected"],
    ];
    for (const [current, material, verified, expected] of cases) {
      expect(statusAfterEdit(current, material, verified)).toBe(expected);
    }
  });
});
