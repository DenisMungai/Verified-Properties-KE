import type { BadgeTone } from "@/components/ui/Badge";
import type { VerificationStatus } from "./rules";

/**
 * What the lister's verification page shows (prompt S12 decision 10), one state at a time. Pure;
 * the page passes in what it read from the database.
 */

export interface LatestRequestFacts {
  status: VerificationStatus;
  decisionReason: string | null;
  submittedAt: Date | null;
  reviewExpiresAt: Date | null;
}

export type CreditFact = { kind: "credited"; note: string } | { kind: "skipped" } | null;

export type ListerView =
  | { state: "not_started"; listingPlanOk: boolean; reapply: boolean }
  | { state: "awaiting_payment"; listingPlanOk: boolean }
  | { state: "upload"; changesReason: string | null }
  | { state: "under_review"; submittedAt: Date | null }
  | { state: "verified"; expiresAt: Date; badgeLive: boolean }
  | { state: "rejected"; reason: string | null; credit: CreditFact; listingPlanOk: boolean }
  | { state: "suspended"; reason: string | null };

export function listerView(input: {
  latest: LatestRequestFacts | null;
  listingPlanOk: boolean;
  badgeLive: boolean;
  credit: CreditFact;
  now: Date;
}): ListerView {
  const { latest, listingPlanOk, badgeLive, credit, now } = input;
  if (!latest) return { state: "not_started", listingPlanOk, reapply: false };
  switch (latest.status) {
    case "payment_pending":
      return { state: "awaiting_payment", listingPlanOk };
    case "documents_pending":
      return { state: "upload", changesReason: latest.decisionReason };
    case "under_review":
      return { state: "under_review", submittedAt: latest.submittedAt };
    case "verified":
      if (latest.reviewExpiresAt && latest.reviewExpiresAt.getTime() > now.getTime()) {
        return { state: "verified", expiresAt: latest.reviewExpiresAt, badgeLive };
      }
      return { state: "not_started", listingPlanOk, reapply: true };
    case "rejected":
      return { state: "rejected", reason: latest.decisionReason, credit, listingPlanOk };
    case "suspended":
      return { state: "suspended", reason: latest.decisionReason };
    case "expired":
    case "unverified":
      return { state: "not_started", listingPlanOk, reapply: true };
  }
}

/** The short status pill used on the page and the billing card. Text always carries the meaning. */
export function viewBadge(view: ListerView): { label: string; tone: BadgeTone } {
  switch (view.state) {
    case "not_started":
      return { label: "Not verified", tone: "neutral" };
    case "awaiting_payment":
      return { label: "Awaiting payment", tone: "neutral" };
    case "upload":
      return view.changesReason ? { label: "Changes requested", tone: "warning" } : { label: "Documents needed", tone: "warning" };
    case "under_review":
      return { label: "Under review", tone: "warning" };
    case "verified":
      return view.badgeLive ? { label: "Profile verified", tone: "verified" } : { label: "Badge paused", tone: "warning" };
    case "rejected":
      return { label: "Not approved", tone: "danger" };
    case "suspended":
      return { label: "Suspended", tone: "danger" };
  }
}
