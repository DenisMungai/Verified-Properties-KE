import { invalidatePublicListings } from "@/lib/cache/public-listings";
import { getJobDeps, getSigningKeys } from "@/lib/jobs/app-deps";
import { handleJobRequest } from "@/lib/jobs/handle-request";
import type { JobName } from "@/lib/jobs/types";

/** Jobs that can pause or restore listings or end a verified badge. */
const PUBLIC_LISTING_JOBS = ["grace-expiry", "plan-changes", "payment-checks", "reconciliation", "verification-lifecycle"] as const satisfies readonly JobName[];

/** Batches keep each run well under this (prompt S9 decision 16). */
export const maxDuration = 60;

/**
 * QStash job endpoint (prompt S9). POST only; the QStash signature over the raw body is checked
 * before any database read. Schedules are registered by `npm run jobs:schedule`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }): Promise<Response> {
  const { job } = await params;
  const response = await handleJobRequest(request, job, { keys: getSigningKeys(), deps: getJobDeps });
  // Here, not in the job code: `npm run jobs:run` runs the same jobs outside Next.
  if (response.ok && (PUBLIC_LISTING_JOBS as readonly string[]).includes(job)) invalidatePublicListings();
  return response;
}
