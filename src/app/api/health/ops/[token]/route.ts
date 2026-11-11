import { connection } from "next/server";
import { getDb } from "@/db";
import { readJobHealth, readPushStats } from "@/db/queries/ops-health";
import { getServerEnv } from "@/lib/env";
import { tokenMatches } from "@/lib/mpesa/callback-guard";
import { opsBody, runOpsChecks } from "@/lib/monitoring/rules";
import { withTimeout } from "@/lib/monitoring/timeout";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Ops health for UptimeRobot (prompt S21 decision 3): database, background jobs and M-Pesa
 * callbacks. A secret path token (`OPS_HEALTH_TOKEN`, compared in constant time); anything else
 * is a bare 404, like the payment callback paths. 200 when every check passes, 503 otherwise.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  await connection();
  const [{ token }, expected] = [await params, getServerEnv().OPS_HEALTH_TOKEN];
  if (!expected || !tokenMatches(token, expected)) return new Response(null, { status: 404, headers: NO_STORE });

  const db = getDb();
  const result = await withTimeout(
    runOpsChecks({ readJobs: (now) => readJobHealth(db, now), readPushStats: (now) => readPushStats(db, now) }, new Date()),
    8_000,
  ).catch(() => null);
  if (!result) return Response.json({ status: "fail", checks: { database: "fail" } }, { status: 503, headers: NO_STORE });
  return Response.json(opsBody(result), { status: result.ok ? 200 : 503, headers: NO_STORE });
}
