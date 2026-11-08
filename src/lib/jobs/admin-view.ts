import type { BadgeTone } from "@/components/ui/Badge";
import { JOB_RUN_STUCK_MIN, MINUTE_MS } from "@/lib/notifications/constants";

/** Pure view helpers for the admin Jobs & emails page (prompt S16 decisions 8 and 12). */

export type RunBadge = "ok" | "partial" | "failed" | "skipped" | "stuck" | "running" | "never";

export const RUN_BADGES: Record<RunBadge, { label: string; tone: BadgeTone }> = {
  ok: { label: "OK", tone: "success" },
  partial: { label: "Partly failed", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
  stuck: { label: "Didn't finish", tone: "warning" },
  running: { label: "Running", tone: "info" },
  never: { label: "Never run", tone: "neutral" },
};

export function runBadge(
  run: { status: string; counts: Record<string, number>; startedAt: Date } | undefined,
  now: Date,
): RunBadge {
  if (!run) return "never";
  switch (run.status) {
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "running":
      return now.getTime() - run.startedAt.getTime() > JOB_RUN_STUCK_MIN * MINUTE_MS ? "stuck" : "running";
    default:
      return (run.counts.failed ?? 0) > 0 ? "partial" : "ok";
  }
}

/** No finished run within twice the schedule interval. A job that never ran isn't "overdue". */
export function isOverdue(lastFinished: Date | undefined, hasRun: boolean, intervalMs: number, now: Date): boolean {
  if (!hasRun) return false;
  return !lastFinished || now.getTime() - lastFinished.getTime() > 2 * intervalMs;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function timeAgo(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function durationLabel(ms: number | null): string {
  if (ms === null) return "–";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** "candidates 3 · failed 1": non-zero counts, for the failed-runs list. */
export function countsLabel(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n !== 0)
    .map(([key, n]) => `${key} ${n}`);
  return parts.length > 0 ? parts.join(" · ") : "No counts";
}
