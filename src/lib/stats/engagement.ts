/**
 * Lister engagement numbers (prompt S13 decisions 12–13). Pure and client-safe.
 * Views are a lister-facing number only: they never feed ranking or the badge, so inflating them
 * gains nothing.
 */

/** Views have been counted since this Nairobi day (the S13 deploy). Earlier windows read "Not tracked yet". */
export const LISTING_VIEWS_SINCE = "2026-11-06";

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The Nairobi calendar day of an instant, as YYYY-MM-DD (Nairobi is UTC+3, no daylight saving). */
export function nairobiDay(at: Date): string {
  return new Date(at.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whether view counts cover the whole window starting at `from`. */
export function viewsTrackedFrom(from: Date): boolean {
  return nairobiDay(from) >= LISTING_VIEWS_SINCE;
}

export type Change = { kind: "up" | "down"; percent: number } | { kind: "flat" } | { kind: "no_baseline" };

/** Change from `previous` to `current`, rounded to whole percent. */
export function percentChange(current: number, previous: number): Change {
  if (previous <= 0) return current > 0 ? { kind: "no_baseline" } : { kind: "flat" };
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { kind: "flat" };
  return percent > 0 ? { kind: "up", percent } : { kind: "down", percent: -percent };
}

/** "+12% vs previous 30 days", "−5% …", "Same as …"; null when there's nothing to compare with. */
export function changeLabel(change: Change, period: string): string | null {
  switch (change.kind) {
    case "up":
      return `+${change.percent}% vs ${period}`;
    case "down":
      return `−${change.percent}% vs ${period}`;
    case "flat":
      return `Same as ${period}`;
    case "no_baseline":
      return null;
  }
}

/** Words for screen readers: the sign alone isn't enough. */
export function changeWords(change: Change, period: string): string | null {
  switch (change.kind) {
    case "up":
      return `up ${change.percent}% on ${period}`;
    case "down":
      return `down ${change.percent}% on ${period}`;
    case "flat":
      return `the same as ${period}`;
    case "no_baseline":
      return null;
  }
}

/** Per-day average, one decimal place. */
export function perDay(total: number, days: number): number {
  if (days <= 0) return 0;
  return Math.round((total / days) * 10) / 10;
}

/** Days of the comparison: `after` is the last 30 days, or since approval when that's shorter. */
export const COMPARISON_DAYS = 30;
export const COMPARISON_MIN_DAYS = 7;

export interface ComparisonWindows {
  before: { from: Date; to: Date; days: number };
  after: { from: Date; to: Date; days: number };
}

/** Null until `COMPARISON_MIN_DAYS` have passed since the first approval. */
export function comparisonWindows(firstApprovedAt: Date, now: Date): ComparisonWindows | null {
  const since = now.getTime() - firstApprovedAt.getTime();
  if (since < COMPARISON_MIN_DAYS * DAY_MS) return null;
  const afterDays = Math.min(COMPARISON_DAYS, Math.floor(since / DAY_MS));
  return {
    before: { from: new Date(firstApprovedAt.getTime() - COMPARISON_DAYS * DAY_MS), to: firstApprovedAt, days: COMPARISON_DAYS },
    after: { from: new Date(now.getTime() - afterDays * DAY_MS), to: now, days: afterDays },
  };
}
