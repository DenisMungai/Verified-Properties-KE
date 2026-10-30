import { getJobDeps, getSigningKeys } from "@/lib/jobs/app-deps";
import { handleJobRequest } from "@/lib/jobs/handle-request";

/** Batches keep each run well under this (prompt S9 decision 16). */
export const maxDuration = 60;

/**
 * QStash job endpoint (prompt S9). POST only; the QStash signature over the raw body is checked
 * before any database read. Schedules are registered by `npm run jobs:schedule`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }): Promise<Response> {
  const { job } = await params;
  return handleJobRequest(request, job, { keys: getSigningKeys(), deps: getJobDeps });
}
