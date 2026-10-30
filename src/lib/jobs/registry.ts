import "server-only";
import { runGraceExpiry } from "./grace-expiry";
import { runPaymentChecks } from "./payment-checks";
import { runPlanChanges } from "./plan-changes";
import { runReconciliation } from "./reconciliation";
import { runRenewalReminders } from "./renewal-reminders";
import { runStorageCleanup } from "./storage-cleanup";
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
};

export { JOB_SCHEDULES };

export async function runJob(name: JobName, deps: JobDeps): Promise<JobSummary> {
  const started = Date.now();
  console.info(`[jobs] ${name} start`);
  const result = await JOBS[name](deps);
  const summary: JobSummary = { job: name, durationMs: Date.now() - started, ...result };
  console.info(`[jobs] ${name} done ${JSON.stringify(summary.counts)}`);
  return summary;
}
