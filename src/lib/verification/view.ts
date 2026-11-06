import type { BadgeTone } from "@/components/ui/Badge";
import { formatNairobiDate } from "@/lib/format";
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
  /** When an expired review stopped counting (S13). */
  endedAt?: Date | null;
  /** Set on a re-review (S13): the approved request it will replace. */
  renewsRequestId?: string | null;
}

export type CreditFact = { kind: "credited"; note: string } | { kind: "skipped" } | null;

export type ListerView =
  | { state: "not_started"; listingPlanOk: boolean; reapply: boolean }
  | { state: "awaiting_payment"; listingPlanOk: boolean }
  /** `currentEndsAt`: during a re-review, when the review that still holds the badge ends. */
  | { state: "upload"; changesReason: string | null; currentEndsAt: Date | null }
  | { state: "under_review"; submittedAt: Date | null; currentEndsAt: Date | null }
  | { state: "verified"; expiresAt: Date; badgeLive: boolean; canRereview: boolean }
  | { state: "expired"; endedAt: Date; canRereview: boolean; listingPlanOk: boolean }
  | {
      state: "rejected";
      reason: string | null;
      credit: CreditFact;
      listingPlanOk: boolean;
      /** A re-review was declined (S13): no fee, and the older review may still count. */
      rereview: boolean;
      currentEndsAt: Date | null;
      canRereview: boolean;
    }
  | { state: "suspended"; reason: string | null };

export function listerView(input: {
  latest: LatestRequestFacts | null;
  listingPlanOk: boolean;
  badgeLive: boolean;
  credit: CreditFact;
  now: Date;
  /** The most recent approved review (`verified` or `expired`), for re-review states (S13). */
  lastApproved?: { status: VerificationStatus; reviewExpiresAt: Date | null } | null;
  /** `canStartRereview(...)` already evaluated by the caller. */
  canRereview?: boolean;
}): ListerView {
  const { latest, listingPlanOk, badgeLive, credit, now } = input;
  const canRereview = input.canRereview ?? false;
  const isRereview = Boolean(latest?.renewsRequestId);
  // The review still holding the badge while a re-review runs, if it hasn't ended.
  const approvedEnd = input.lastApproved?.status === "verified" ? input.lastApproved.reviewExpiresAt : null;
  const currentEndsAt = isRereview && approvedEnd && approvedEnd.getTime() > now.getTime() ? approvedEnd : null;

  if (!latest) return { state: "not_started", listingPlanOk, reapply: false };
  switch (latest.status) {
    case "payment_pending":
      return { state: "awaiting_payment", listingPlanOk };
    case "documents_pending":
      return { state: "upload", changesReason: latest.decisionReason, currentEndsAt };
    case "under_review":
      return { state: "under_review", submittedAt: latest.submittedAt, currentEndsAt };
    case "verified":
      if (latest.reviewExpiresAt && latest.reviewExpiresAt.getTime() > now.getTime()) {
        return { state: "verified", expiresAt: latest.reviewExpiresAt, badgeLive, canRereview };
      }
      // Ended by time; the daily job hasn't recorded it yet.
      return latest.reviewExpiresAt
        ? { state: "expired", endedAt: latest.reviewExpiresAt, canRereview, listingPlanOk }
        : { state: "not_started", listingPlanOk, reapply: true };
    case "expired": {
      const endedAt = latest.endedAt ?? latest.reviewExpiresAt;
      return endedAt ? { state: "expired", endedAt, canRereview, listingPlanOk } : { state: "not_started", listingPlanOk, reapply: true };
    }
    case "rejected":
      return {
        state: "rejected",
        reason: latest.decisionReason,
        credit,
        listingPlanOk,
        rereview: isRereview,
        currentEndsAt,
        canRereview,
      };
    case "suspended":
      return { state: "suspended", reason: latest.decisionReason };
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
    case "expired":
      return { label: "Review ended", tone: "neutral" };
    case "rejected":
      return view.rereview ? { label: "Re-review not approved", tone: "danger" } : { label: "Not approved", tone: "danger" };
    case "suspended":
      return { label: "Suspended", tone: "danger" };
  }
}

/**
 * One sentence about where the lister stands (billing card and dashboard stat card, S13). Pure.
 */
export function viewSummary(view: ListerView): string {
  switch (view.state) {
    case "not_started":
      return "Paid verification with an admin review. The badge appears only after a review passes.";
    case "awaiting_payment":
      return "Your review starts once the verification payment is confirmed.";
    case "upload":
      return view.currentEndsAt
        ? `Re-review: upload fresh documents. Your badge stays until ${formatNairobiDate(view.currentEndsAt)}.`
        : "Payment received. Upload your documents to start the review.";
    case "under_review":
      return view.currentEndsAt
        ? `Your re-review is with our team. Your badge stays until ${formatNairobiDate(view.currentEndsAt)}.`
        : "Your documents are with our team, usually decided within 2 working days.";
    case "verified":
      if (!view.badgeLive) return "A plan has lapsed, so your badge is hidden. Renew to restore it.";
      return view.canRereview
        ? `Your review ends ${formatNairobiDate(view.expiresAt)}. Start your re-review now.`
        : `In good standing. Your review is valid until ${formatNairobiDate(view.expiresAt)}.`;
    case "expired":
      return view.canRereview
        ? `Your review ended ${formatNairobiDate(view.endedAt)}. Start a re-review; it's included in your plan.`
        : `Your review ended ${formatNairobiDate(view.endedAt)}. Renew verification to get the badge back.`;
    case "rejected":
      if (!view.rereview) return "Your last review wasn't approved. See why, and apply again when ready.";
      return view.currentEndsAt
        ? `Your re-review wasn't approved. Your badge stays until ${formatNairobiDate(view.currentEndsAt)}.`
        : "Your re-review wasn't approved. See why, and try again when ready.";
    case "suspended":
      return "Your badge is suspended. See the reason on the verification page.";
  }
}

/** The dashboard stat card's one short line under the status (S13 decision 13). Pure. */
export function viewShortLine(view: ListerView): string {
  switch (view.state) {
    case "not_started":
      return "Get the verified badge";
    case "awaiting_payment":
      return "Finish paying to start your review";
    case "upload":
      return view.currentEndsAt ? "Re-review: upload your documents" : "Upload your documents";
    case "under_review":
      return "Usually decided within 2 working days";
    case "verified":
      if (!view.badgeLive) return "Renew to restore the badge";
      return view.canRereview ? `Re-review due by ${formatNairobiDate(view.expiresAt)}` : "In good standing";
    case "expired":
      return `Review ended ${formatNairobiDate(view.endedAt)}`;
    case "rejected":
      return view.rereview && view.currentEndsAt ? `Badge stays until ${formatNairobiDate(view.currentEndsAt)}` : "See why and try again";
    case "suspended":
      return "Contact support";
  }
}
