import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Lister-side listing workflow (plan v2.0 §6, §9; prompt S3 decisions 6–9). Pure. Approve, reject
 * and pause are never lister actions: moderation (S8) and billing jobs (S9) own them.
 */

export const LISTING_STATUSES = [
  "draft",
  "pending_review",
  "published",
  "paused",
  "rejected",
  "rented",
  "sold",
  "withdrawn",
  "archived",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type ListingType = "sale" | "rent";

/** Statuses in which a lister may edit details. */
export const LISTER_EDITABLE_STATUSES = [
  "draft",
  "rejected",
  "pending_review",
  "published",
  "paused",
] as const satisfies readonly ListingStatus[];

/** Statuses a lister may submit from (to published or pending_review). */
export const SUBMITTABLE_STATUSES = ["draft", "rejected"] as const satisfies readonly ListingStatus[];

export function isEditableByLister(status: ListingStatus): boolean {
  return (LISTER_EDITABLE_STATUSES as readonly ListingStatus[]).includes(status);
}

export function canSubmit(status: ListingStatus): boolean {
  return (SUBMITTABLE_STATUSES as readonly ListingStatus[]).includes(status);
}

/** Plain status changes a lister may request (submit, un-pause and delete have their own rules). */
export const LISTER_TRANSITION_TARGETS = ["draft", "rented", "sold", "withdrawn", "archived"] as const;
export type ListerTransitionTarget = (typeof LISTER_TRANSITION_TARGETS)[number];

export function listerCanTransition(
  from: ListingStatus,
  to: ListingStatus,
  { listingType }: { listingType: ListingType },
): boolean {
  switch (from) {
    case "draft":
      return to === "archived";
    case "pending_review":
      return to === "draft";
    case "rejected":
      return to === "draft" || to === "archived";
    case "published":
      if (to === "rented") return listingType === "rent";
      if (to === "sold") return listingType === "sale";
      return to === "withdrawn" || to === "archived";
    case "paused":
      return to === "withdrawn" || to === "archived";
    case "rented":
    case "sold":
    case "withdrawn":
      return to === "archived";
    case "archived":
      return false;
  }
}

/** A draft that was never submitted or reviewed may be deleted outright; others are archived. */
export function canDeleteDraft(row: { status: ListingStatus; publishedAt: Date | null; reviewedAt: Date | null }): boolean {
  return row.status === "draft" && row.publishedAt === null && row.reviewedAt === null;
}

/** Changing any of these on a published listing sends an unverified lister's listing back to review. */
export const MATERIAL_FIELDS = [
  "title",
  "description",
  "category",
  "listingType",
  "county",
  "town",
  "neighbourhood",
] as const;
export type MaterialField = (typeof MATERIAL_FIELDS)[number];

export function isMaterialEdit(
  before: Record<MaterialField, unknown>,
  after: Record<MaterialField, unknown>,
): boolean {
  return MATERIAL_FIELDS.some((field) => (before[field] ?? null) !== (after[field] ?? null));
}

/** The status after a lister saves edits. Verified listers are not pre-reviewed (plan §16). */
export function statusAfterEdit(current: ListingStatus, material: boolean, ownerVerified: boolean): ListingStatus {
  return current === "published" && material && !ownerVerified ? "pending_review" : current;
}

export const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Draft",
  pending_review: "In review",
  published: "Published",
  paused: "Paused",
  rejected: "Needs changes",
  rented: "Rented",
  sold: "Sold",
  withdrawn: "Withdrawn",
  archived: "Archived",
};

export const STATUS_TONES: Record<ListingStatus, BadgeTone> = {
  draft: "neutral",
  pending_review: "warning",
  published: "success",
  paused: "warning",
  rejected: "danger",
  rented: "info",
  sold: "info",
  withdrawn: "neutral",
  archived: "neutral",
};

/** Button labels for plain transitions. */
export const TRANSITION_LABELS: Record<ListerTransitionTarget, string> = {
  draft: "Withdraw submission",
  rented: "Mark as rented",
  sold: "Mark as sold",
  withdrawn: "Withdraw listing",
  archived: "Archive",
};
