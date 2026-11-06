import "server-only";
import type { DbExecutor } from "@/db/executor";
import { inquiriesReceived, savesReceived, viewsReceived } from "@/db/queries/lister-stats";
import { getFirstApprovalAt } from "@/db/queries/verification";
import { comparisonWindows, DAY_MS, nairobiDay, percentChange, perDay, viewsTrackedFrom, type Change } from "./engagement";

/**
 * The lister dashboard's numbers (prompt S13 decision 13), for `userId` only: 30-day enquiries and
 * views against the 30 days before, and the "Since you were verified" comparison.
 */

const WINDOW_DAYS = 30;

export interface StatFigure {
  total: number;
  /** Null when the previous window can't be compared (views not tracked then). */
  change: Change | null;
}

export interface ComparisonRow {
  metric: "views" | "saves" | "enquiries";
  /** Per-day averages; `before` is null when views weren't tracked yet. */
  before: number | null;
  after: number;
  change: Change | null;
}

export type Comparison =
  | { kind: "none" }
  | { kind: "too_soon"; firstApprovedAt: Date }
  | { kind: "ready"; firstApprovedAt: Date; afterDays: number; rows: ComparisonRow[] };

export interface ListerStats {
  enquiries: StatFigure;
  views: StatFigure;
  comparison: Comparison;
}

const viewDays = (from: Date, to: Date) => [nairobiDay(from), nairobiDay(to)] as const;

async function comparison(db: DbExecutor, userId: string, now: Date): Promise<Comparison> {
  const firstApprovedAt = await getFirstApprovalAt(db, userId);
  if (!firstApprovedAt) return { kind: "none" };
  const windows = comparisonWindows(firstApprovedAt, now);
  if (!windows) return { kind: "too_soon", firstApprovedAt };
  const { before, after } = windows;
  const viewsBeforeTracked = viewsTrackedFrom(before.from);
  const [viewsBefore, viewsAfter, savesBefore, savesAfter, enquiriesBefore, enquiriesAfter] = await Promise.all([
    viewsBeforeTracked ? viewsReceived(db, userId, ...viewDays(before.from, before.to)) : Promise.resolve(null),
    viewsReceived(db, userId, ...viewDays(after.from, after.to)),
    savesReceived(db, userId, before.from, before.to),
    savesReceived(db, userId, after.from, after.to),
    inquiriesReceived(db, userId, before.from, before.to),
    inquiriesReceived(db, userId, after.from, after.to),
  ]);
  const row = (metric: ComparisonRow["metric"], b: number | null, a: number): ComparisonRow => {
    const beforeAvg = b === null ? null : perDay(b, before.days);
    const afterAvg = perDay(a, after.days);
    return { metric, before: beforeAvg, after: afterAvg, change: beforeAvg === null ? null : percentChange(afterAvg, beforeAvg) };
  };
  return {
    kind: "ready",
    firstApprovedAt,
    afterDays: after.days,
    rows: [row("views", viewsBefore, viewsAfter), row("saves", savesBefore, savesAfter), row("enquiries", enquiriesBefore, enquiriesAfter)],
  };
}

export async function loadListerStats(db: DbExecutor, userId: string, now: Date): Promise<ListerStats> {
  const start = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const previous = new Date(now.getTime() - 2 * WINDOW_DAYS * DAY_MS);
  const previousTracked = viewsTrackedFrom(previous);
  const [enquiriesNow, enquiriesBefore, viewsNow, viewsBefore, compared] = await Promise.all([
    inquiriesReceived(db, userId, start, now),
    inquiriesReceived(db, userId, previous, start),
    viewsReceived(db, userId, ...viewDays(start, now)),
    previousTracked ? viewsReceived(db, userId, ...viewDays(previous, start)) : Promise.resolve(null),
    comparison(db, userId, now),
  ]);
  return {
    enquiries: { total: enquiriesNow, change: percentChange(enquiriesNow, enquiriesBefore) },
    views: { total: viewsNow, change: viewsBefore === null ? null : percentChange(viewsNow, viewsBefore) },
    comparison: compared,
  };
}
