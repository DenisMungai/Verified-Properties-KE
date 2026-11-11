import { connection } from "next/server";
import { getDb } from "@/db";
import { pingDatabase } from "@/db/queries/ops-health";
import { withTimeout } from "@/lib/monitoring/timeout";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public uptime check (prompt S21 decision 2): the site and database are up. Returns only
 * `{ status }`: no version, region, timings or error text.
 */
export async function GET(): Promise<Response> {
  await connection();
  try {
    await withTimeout(pingDatabase(getDb()), 3_000);
    return Response.json({ status: "ok" }, { headers: NO_STORE });
  } catch {
    return Response.json({ status: "down" }, { status: 503, headers: NO_STORE });
  }
}
