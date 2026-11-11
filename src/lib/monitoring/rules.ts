/**
 * Operations health rules (prompt S21 decision 3). Pure: the route gathers the inputs, these
 * decide. The response carries check names and job names only, never ids or personal data.
 */
import { isOverdue } from "@/lib/jobs/admin-view";
import { JOB_INTERVAL_MS } from "@/lib/jobs/schedules";
import { JOB_NAMES, type JobName } from "@/lib/jobs/types";

const MINUTE_MS = 60_000;

/** STK pushes are judged between these ages: old enough for a callback, recent enough to matter. */
export const CALLBACK_WINDOW_MS = 120 * MINUTE_MS;
export const CALLBACK_GRACE_MS = 15 * MINUTE_MS;
/** Fewer pushes than this in the window says nothing (no traffic is not an outage). */
export const CALLBACK_MIN_PUSHES = 2;
/** Callbacks are "stalled" when at least this share of pushes, and at least the minimum, got none. */
export const CALLBACK_MISSING_SHARE = 0.5;

export type CheckName = "database" | "jobs_overdue" | "jobs_failing" | "payment_callbacks";
export type CheckState = "ok" | "fail";

export interface PushStats {
  /** STK pushes recorded in the window. */
  pushes: number;
  /** Of those, how many have no `stk_callback` event. */
  missing: number;
}

export interface JobHealth {
  /** Last run that finished ok or skipped. */
  lastFinished: Date | undefined;
  hasRun: boolean;
  latestStatus: string | undefined;
}

export interface OpsInputs {
  jobs: ReadonlyMap<JobName, JobHealth>;
  pushes: PushStats;
}

export interface OpsResult {
  ok: boolean;
  checks: Record<CheckName, CheckState>;
  overdueJobs: JobName[];
  failingJobs: JobName[];
}

export function callbacksStalled({ pushes, missing }: PushStats): boolean {
  if (pushes < CALLBACK_MIN_PUSHES) return false;
  return missing >= CALLBACK_MIN_PUSHES && missing / pushes >= CALLBACK_MISSING_SHARE;
}

export function evaluateOps(inputs: OpsInputs, now: Date): OpsResult {
  const overdueJobs = JOB_NAMES.filter((job) => {
    const health = inputs.jobs.get(job);
    return isOverdue(health?.lastFinished, health?.hasRun ?? false, JOB_INTERVAL_MS[job], now);
  });
  const failingJobs = JOB_NAMES.filter((job) => inputs.jobs.get(job)?.latestStatus === "failed");
  const checks: Record<CheckName, CheckState> = {
    database: "ok",
    jobs_overdue: overdueJobs.length ? "fail" : "ok",
    jobs_failing: failingJobs.length ? "fail" : "ok",
    payment_callbacks: callbacksStalled(inputs.pushes) ? "fail" : "ok",
  };
  return { ok: Object.values(checks).every((c) => c === "ok"), checks, overdueJobs, failingJobs };
}

/** When the database can't be read, every other check is unknown, so only `database` fails. */
export const DATABASE_DOWN: OpsResult = {
  ok: false,
  checks: { database: "fail", jobs_overdue: "ok", jobs_failing: "ok", payment_callbacks: "ok" },
  overdueJobs: [],
  failingJobs: [],
};

export interface OpsDeps {
  readJobs: (now: Date) => Promise<ReadonlyMap<JobName, JobHealth>>;
  readPushStats: (now: Date) => Promise<PushStats>;
}

export async function runOpsChecks(deps: OpsDeps, now: Date): Promise<OpsResult> {
  try {
    const [jobs, pushes] = await Promise.all([deps.readJobs(now), deps.readPushStats(now)]);
    return evaluateOps({ jobs, pushes }, now);
  } catch {
    return DATABASE_DOWN;
  }
}

/** The JSON body for the ops route: names only. */
export function opsBody(result: OpsResult): Record<string, unknown> {
  return {
    status: result.ok ? "ok" : "fail",
    checks: result.checks,
    ...(result.overdueJobs.length ? { overdueJobs: result.overdueJobs } : {}),
    ...(result.failingJobs.length ? { failingJobs: result.failingJobs } : {}),
  };
}
