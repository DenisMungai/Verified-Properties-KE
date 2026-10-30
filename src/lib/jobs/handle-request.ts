import "server-only";
import { runJob } from "./registry";
import { verifyQstashSignature, type SigningKeys } from "./signature";
import { isJobName, type JobDeps } from "./types";

/**
 * `/api/jobs/[job]` (prompt S9 decisions 2–3), kept out of the route file so tests can call it.
 * Order: known job name, signing keys present, valid signature over the raw body, then run. The
 * body is verified, never parsed: a signed request can't steer what a job does.
 * - 200 with the summary when the job finished, even if some items failed (retried next run)
 * - 500 only when the job couldn't run, so QStash retries with backoff
 */
export async function handleJobRequest(
  request: Request,
  name: string,
  { keys, deps }: { keys: SigningKeys | null; deps: () => JobDeps },
): Promise<Response> {
  if (!isJobName(name)) return Response.json({ error: "not_found" }, { status: 404 });

  const body = await request.text();
  const check = await verifyQstashSignature(keys, request.headers.get("upstash-signature"), body);
  if (check === "not_configured") {
    console.error("[jobs] signing keys not configured");
    return Response.json({ error: "jobs_not_configured" }, { status: 503 });
  }
  if (check === "invalid") {
    console.warn(`[jobs] ${name} rejected: invalid signature`);
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  try {
    return Response.json(await runJob(name, deps()));
  } catch (error) {
    console.error(`[jobs] ${name} failed error=${error instanceof Error ? error.name : "unknown"}`);
    return Response.json({ error: "job_failed" }, { status: 500 });
  }
}
