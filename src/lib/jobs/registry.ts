import "server-only";
import { finishJobRun, startJobRun } from "@/db/queries/job-runs";
import { errorName } from "@/lib/log";
import { runGraceExpiry } from "./grace-expiry";
import { runNotifications } from "./notifications";
import { runPaymentChecks } from "./payment-checks";
import { runPlanChanges } from "./plan-changes";
import { runReconciliation } from "./reconciliation";
import { runRenewalReminders } from "./renewal-reminders";
import { runReviewReminders } from "./review-reminders";
import { runStorageCleanup } from "./storage-cleanup";
import { runVerificationLifecycle } from "./verification-lifecycle";
import { JOB_SCHEDULES } from "./schedules";
import type { JobDeps, JobName, JobRun, JobSummary } from "./types";

/** Every job, by name. The route and `jobs:run` both go through `runJob`, so they can't drift. */
export const JOBS: Record<JobName, JobRun> = {
  "grace-expiry": runGraceExpiry,
  "plan-changes": runPlanChanges,
  "renewal-reminders": runRenewalReminders,
  "payment-checks": runPaymentChecks,
  reconciliation: runReconciliation,
  "storage-cleanup": runStorageCleanup,
  "verification-lifecycle": runVerificationLifecycle,
  notifications: runNotifications,
  "review-reminders": runReviewReminders,
};

export { JOB_SCHEDULES };

/** Best-effort run recording (prompt S16 decision 8): a failure is logged and never stops the job. */
async function recordStart(deps: JobDeps, name: JobName): Promise<string | null> {
  try {
    return await startJobRun(deps.db, name, deps.now());
  } catch (error) {
    console.error(`[jobs] ${name} run not recorded error=${errorName(error)}`);
    return null;
  }
}

async function recordFinish(deps: JobDeps, name: JobName, runId: string | null, run: Parameters<typeof finishJobRun>[2]): Promise<void> {
  if (!runId) return;
  try {
    await finishJobRun(deps.db, runId, run);
  } catch (error) {
    console.error(`[jobs] ${name} run end not recorded error=${errorName(error)}`);
  }
}

export async function runJob(name: JobName, deps: JobDeps): Promise<JobSummary> {
  const started = Date.now();
  console.info(`[jobs] ${name} start`);
  const runId = await recordStart(deps, name);
  try {
    const result = await JOBS[name](deps);
    const summary: JobSummary = { job: name, durationMs: Date.now() - started, ...result };
    await recordFinish(deps, name, runId, { status: result.status, finishedAt: deps.now(), durationMs: summary.durationMs, counts: result.counts });
    console.info(`[jobs] ${name} done ${JSON.stringify(summary.counts)}`);
    return summary;
  } catch (error) {
    await recordFinish(deps, name, runId, { status: "failed", finishedAt: deps.now(), durationMs: Date.now() - started, counts: {}, error: errorName(error) });
    throw error;
  }
}
