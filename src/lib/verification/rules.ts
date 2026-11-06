/**
 * Verification rules (prompt S12): which documents each lister type sends, the file limits, the
 * status life cycle and its labels. Pure and client-safe: the upload UI shows the same numbers the
 * server enforces, and the server decides every transition with `canTransition`.
 */

/* -------------------------------------------------------------------------- */
/* Documents (decision 1)                                                     */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_TYPES = ["national_id", "earb_certificate", "business_registration"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_LABELS: Record<DocumentType, { label: string; hint: string }> = {
  national_id: {
    label: "National ID or passport",
    hint: "Your Kenyan national ID (front and back) or the photo page of your passport.",
  },
  earb_certificate: {
    label: "EARB practising certificate",
    hint: "Your current Estate Agents Registration Board practising certificate.",
  },
  business_registration: {
    label: "Business registration",
    hint: "The certificate of registration or incorporation, or a recent CR12.",
  },
};

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export type VerificationListerType = "agent" | "owner" | "developer";

/** Everyone sends an ID; agents add EARB; developers and agency members add business registration. */
export function requiredDocumentTypes(listerType: VerificationListerType, inAgency: boolean): DocumentType[] {
  const types: DocumentType[] = ["national_id"];
  if (listerType === "agent") types.push("earb_certificate");
  if (listerType === "developer" || inAgency) types.push("business_registration");
  return types;
}

/** Required types with no file yet, in display order. */
export function missingDocumentTypes(required: readonly DocumentType[], uploaded: readonly string[]): DocumentType[] {
  return required.filter((type) => !uploaded.includes(type));
}

export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentMime = (typeof DOCUMENT_MIME_TYPES)[number];

export function isDocumentMime(value: string): value is DocumentMime {
  return (DOCUMENT_MIME_TYPES as readonly string[]).includes(value);
}

/** Matches the `verification_documents_size_range` check. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_TYPE = 2;
export const MAX_DOCUMENT_FILES = 6;
export const FILE_NAME_MAX = 120;

export const DOCUMENT_REJECT_MESSAGES = {
  type: "Upload a PDF, JPEG or PNG file.",
  size: "Files must be 10 MB or smaller.",
  empty: "That file is empty.",
  perType: `You can add up to ${MAX_FILES_PER_TYPE} files for each document.`,
  total: `You can add up to ${MAX_DOCUMENT_FILES} files in all.`,
  unreadable: "That file could not be read. Try saving it again as a PDF or JPEG.",
} as const;

/**
 * A display label from the browser's file name: letters, digits, spaces, dots, dashes and
 * underscores only, at most FILE_NAME_MAX characters. It is shown to admins and never used in a key.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9 ._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[ ._]+/, "")
    .trim()
    .slice(0, FILE_NAME_MAX)
    .trim();
  return cleaned || "document";
}

/* -------------------------------------------------------------------------- */
/* Statuses (decision 2)                                                      */
/* -------------------------------------------------------------------------- */

export const VERIFICATION_STATUSES = [
  "unverified",
  "payment_pending",
  "documents_pending",
  "under_review",
  "verified",
  "rejected",
  "expired",
  "suspended",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Statuses that hold the lister's single open request (matches the partial unique index). */
export const OPEN_STATUSES = ["payment_pending", "documents_pending", "under_review"] as const satisfies readonly VerificationStatus[];

export function isOpenStatus(status: VerificationStatus): boolean {
  return (OPEN_STATUSES as readonly VerificationStatus[]).includes(status);
}

const TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  unverified: [],
  payment_pending: ["documents_pending"],
  // → rejected only when a suspension closes an open re-review (S13 decision 6); never offered in the UI.
  documents_pending: ["under_review", "rejected"],
  under_review: ["verified", "documents_pending", "rejected"],
  verified: ["suspended", "expired"],
  rejected: [],
  expired: [],
  suspended: [],
};

/** The only way a request's status may change. */
export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A passed review lasts 12 months (plan §4). */
export const REVIEW_VALID_MONTHS = 12;

export function reviewExpiresAt(decidedAt: Date): Date {
  const out = new Date(decidedAt);
  out.setUTCMonth(out.getUTCMonth() + REVIEW_VALID_MONTHS);
  return out;
}

/** Admins aim to decide within this many working days (plan §10). */
export const REVIEW_TARGET_WORKING_DAYS = 2;

/** Whole working days (Mon–Fri, Nairobi) between two instants. Public holidays are not counted. */
export function workingDaysBetween(from: Date, to: Date): number {
  const nairobi = (d: Date) => new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const start = nairobi(from);
  const end = nairobi(to);
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  let days = 0;
  for (const d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

/** "VR-3F9A1C" from a request id: short enough to read out on a support call. */
export function requestNumber(id: string): string {
  return `VR-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export const AUDIT_ACTIONS = [
  "start",
  "pay",
  "upload",
  "remove_document",
  "submit",
  "view_document",
  "request_changes",
  "approve",
  "reject",
  "suspend",
  "credit",
  "credit_skipped",
  "rereview",
  "expire",
  "supersede",
  "purge_documents",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_LABELS: Record<AuditAction, string> = {
  start: "Checkout started",
  pay: "Payment confirmed",
  upload: "Document uploaded",
  remove_document: "Document removed",
  submit: "Submitted for review",
  view_document: "Document viewed",
  request_changes: "Changes requested",
  approve: "Approved",
  reject: "Rejected",
  suspend: "Suspended",
  credit: "Fee credited to listing plan",
  credit_skipped: "Credit not applied",
  rereview: "Re-review started",
  expire: "Review expired",
  supersede: "Replaced by a newer review",
  purge_documents: "Documents deleted (retention)",
};

/* -------------------------------------------------------------------------- */
/* Re-review (prompt S13 decisions 3–4)                                       */
/* -------------------------------------------------------------------------- */

/** A re-review can start this many days before the current review ends (and any time after). */
export const REREVIEW_WINDOW_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

export type RereviewRefusal =
  | "no_approved_review"
  | "too_early"
  | "request_open"
  | "suspended"
  | "verification_plan_inactive"
  | "listing_plan_inactive";

export const REREVIEW_MESSAGES: Record<RereviewRefusal, string> = {
  no_approved_review: "There is no approved review to renew. Start a new verification instead.",
  too_early: `You can start a re-review ${REREVIEW_WINDOW_DAYS} days before your review ends.`,
  request_open: "You already have a verification request in progress.",
  suspended: "Your verification is suspended. Contact support before applying again.",
  verification_plan_inactive: "Renew your verification plan to start a re-review.",
  listing_plan_inactive: "Verification needs an active listing plan. Renew or choose a plan first.",
};

export interface RereviewFacts {
  /** The lister's most recent request with status `verified` or `expired`. */
  lastApproved: { status: VerificationStatus; reviewExpiresAt: Date | null } | null;
  hasOpenRequest: boolean;
  latestStatus: VerificationStatus | null;
  /** Active or in grace. */
  verificationPlanOk: boolean;
  listingPlanOk: boolean;
}

/** Whether a free re-review may start now. Pure: the action re-checks inside its transaction. */
export function canStartRereview(facts: RereviewFacts, now: Date): { ok: true } | { ok: false; code: RereviewRefusal } {
  if (facts.latestStatus === "suspended") return { ok: false, code: "suspended" };
  if (facts.hasOpenRequest) return { ok: false, code: "request_open" };
  const approved = facts.lastApproved;
  if (!approved || !approved.reviewExpiresAt || (approved.status !== "verified" && approved.status !== "expired")) {
    return { ok: false, code: "no_approved_review" };
  }
  if (approved.reviewExpiresAt.getTime() - now.getTime() > REREVIEW_WINDOW_DAYS * DAY) return { ok: false, code: "too_early" };
  if (!facts.verificationPlanOk) return { ok: false, code: "verification_plan_inactive" };
  if (!facts.listingPlanOk) return { ok: false, code: "listing_plan_inactive" };
  return { ok: true };
}

/** Re-review reminder windows (S13 decision 7): "30d" while more than 7 days are left, then "7d". */
export type RereviewReminder = "30d" | "7d";

export function rereviewReminderDue(reviewExpiresAt: Date, now: Date): RereviewReminder | null {
  const left = reviewExpiresAt.getTime() - now.getTime();
  if (left <= 0 || left > REREVIEW_WINDOW_DAYS * DAY) return null;
  return left <= 7 * DAY ? "7d" : "30d";
}

/** The four checks an admin confirms before approving (design 05). */
export const REVIEW_CHECKLIST = [
  { name: "legible", label: "Documents are legible" },
  { name: "names_match", label: "Names and details match" },
  { name: "complete", label: "Required documents included" },
  { name: "consistent", label: "No obvious inconsistencies" },
] as const;
