/**
 * Facts the legal pages state that only the operator can supply (prompt S20 decision 1), plus
 * the response targets they promise (decision 8). Client-safe, no secrets.
 *
 * A `null` fact is never shown as a placeholder: pages fall back to a neutral line. Until
 * `effectiveDate` is set (an ISO date, after the text has been reviewed), every legal page shows
 * the Draft notice.
 */
export interface LegalFacts {
  /** Legal name of the business or person running VerifiedPropertiesKE. */
  operatorName: string | null;
  /** A monitored address for privacy, billing and moderation questions. */
  contactEmail: string | null;
  /** Kenyan postal or physical address. */
  postalAddress: string | null;
  /** Office of the Data Protection Commissioner registration number, if registered. */
  odpcRegistration: string | null;
  /** "YYYY-MM-DD" once the documents are reviewed and in force; null shows the Draft notice. */
  effectiveDate: string | null;
}

export const LEGAL: LegalFacts = {
  operatorName: null,
  contactEmail: null,
  postalAddress: null,
  odpcRegistration: null,
  effectiveDate: null,
};

/** When the wording below was last changed. */
export const LEGAL_LAST_UPDATED = "2026-11-10";

/** Privacy requests: inside the Data Protection Act's 14-day window for most rights. */
export const PRIVACY_RESPONSE_DAYS = 7;
/** Billing and refund questions, matching the verification review target. */
export const BILLING_RESPONSE_WORKING_DAYS = 2;
/** Payment records are kept at least this long (Kenyan tax law; confirm with your accountant). */
export const PAYMENT_RECORD_YEARS = 5;

export const DATA_REQUEST_KINDS = ["access", "correction", "deletion", "objection", "billing", "other"] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];

export const DATA_REQUEST_KIND_LABELS: Record<DataRequestKind, { label: string; hint: string }> = {
  access: { label: "Get a copy of my data", hint: "We send you what we hold about you." },
  correction: { label: "Correct my data", hint: "Tell us what's wrong and what it should say." },
  deletion: { label: "Delete my data", hint: "We remove what we can and tell you what the law makes us keep." },
  objection: { label: "Object to how my data is used", hint: "For example, stop optional messages." },
  billing: { label: "Billing or refund question", hint: "A payment, a refund, a credit or a dispute." },
  other: { label: "Something else", hint: "Any other privacy or account question." },
};

export const DATA_REQUEST_DETAILS_MIN = 10;
export const DATA_REQUEST_DETAILS_MAX = 2000;
export const DATA_REQUEST_NOTE_MAX = 1000;

/** The short reference shown to users: the first 8 characters of the request id. */
export function requestReference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** Days a request of this kind should take to answer, for the confirmation message. */
export function responseTargetFor(kind: DataRequestKind): string {
  return kind === "billing" ? `${BILLING_RESPONSE_WORKING_DAYS} working days` : `${PRIVACY_RESPONSE_DAYS} days`;
}

export const LEGAL_PAGES = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/subscription-policy", label: "Subscriptions & refunds" },
  { href: "/moderation", label: "Moderation" },
] as const;

export const DATA_REQUEST_PATH = "/privacy/request";
