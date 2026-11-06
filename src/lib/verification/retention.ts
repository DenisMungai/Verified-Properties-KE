import type { VerificationStatus } from "./rules";

/**
 * Document retention (prompt S13 decision 7, the "balanced" policy). Pure and client-safe so the
 * lister's notice and the job read the same numbers. A draft for counsel to confirm before launch:
 * the Kenya Data Protection Act 2019 asks for "no longer than necessary", not a fixed period.
 *
 * - expired (ran out or was replaced): 90 days after the review ended
 * - rejected: 90 days after the decision
 * - suspended: 24 months after the suspension (abuse evidence)
 * Open and currently verified requests are never purged.
 */

export const RETENTION_DAYS_AFTER_END = 90;
export const RETENTION_DAYS_AFTER_REJECTION = 90;
export const RETENTION_MONTHS_AFTER_SUSPENSION = 24;

export const RETENTION_NOTICE =
  `We delete your documents ${RETENTION_DAYS_AFTER_END} days after your review ends or is declined ` +
  `(${RETENTION_MONTHS_AFTER_SUSPENSION} months if verification is suspended).`;

const DAY = 24 * 60 * 60 * 1000;

export interface RetentionFacts {
  status: VerificationStatus;
  decidedAt: Date | null;
  endedAt: Date | null;
}

/** When this request's documents may be deleted, or null when they must be kept. */
export function purgeDueAt(facts: RetentionFacts): Date | null {
  switch (facts.status) {
    case "expired":
      return facts.endedAt ? new Date(facts.endedAt.getTime() + RETENTION_DAYS_AFTER_END * DAY) : null;
    case "rejected":
      return facts.decidedAt ? new Date(facts.decidedAt.getTime() + RETENTION_DAYS_AFTER_REJECTION * DAY) : null;
    case "suspended": {
      if (!facts.decidedAt) return null;
      const due = new Date(facts.decidedAt);
      due.setUTCMonth(due.getUTCMonth() + RETENTION_MONTHS_AFTER_SUSPENSION);
      return due;
    }
    default:
      return null;
  }
}

export function isPurgeDue(facts: RetentionFacts, now: Date): boolean {
  const due = purgeDueAt(facts);
  return due !== null && due.getTime() <= now.getTime();
}
