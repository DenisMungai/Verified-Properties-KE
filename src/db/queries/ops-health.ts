import "server-only";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { CALLBACK_GRACE_MS, CALLBACK_WINDOW_MS, type JobHealth, type PushStats } from "@/lib/monitoring/rules";
import { JOB_NAMES, type JobName } from "@/lib/jobs/types";
import { jobOverview } from "./job-runs";

/** Reads for the ops health check (prompt S21 decision 3). Counts and timestamps only. */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Database reachable: one trivial query. */
export async function pingDatabase(db: DbExecutor): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function readJobHealth(db: DbExecutor, now: Date): Promise<ReadonlyMap<JobName, JobHealth>> {
  const overview = await jobOverview(db, new Date(now.getTime() - DAY_MS));
  return new Map(
    JOB_NAMES.map((job) => {
      const latest = overview.latest.get(job);
      return [job, { lastFinished: overview.lastFinished.get(job), hasRun: Boolean(latest), latestStatus: latest?.status }];
    }),
  );
}

/**
 * STK pushes recorded between CALLBACK_WINDOW_MS and CALLBACK_GRACE_MS ago, and how many have no
 * `stk_callback` event for the same payment (uses payment_events_payment_idx).
 */
export async function readPushStats(db: DbExecutor, now: Date): Promise<PushStats> {
  const from = new Date(now.getTime() - CALLBACK_WINDOW_MS);
  const to = new Date(now.getTime() - CALLBACK_GRACE_MS);
  const result = (await db.execute(sql`
    select count(*)::int as pushes,
           count(*) filter (where not exists (
             select 1 from payment_events cb
             where cb.payment_id = p.payment_id and cb.event_type = 'stk_callback'
           ))::int as missing
    from payment_events p
    where p.event_type = 'stk_push'
      and p.payment_id is not null
      and p.created_at >= ${from.toISOString()}::timestamptz
      and p.created_at < ${to.toISOString()}::timestamptz`)) as unknown as { rows: { pushes: number; missing: number }[] };
  const row = result.rows[0] ?? { pushes: 0, missing: 0 };
  return { pushes: Number(row.pushes), missing: Number(row.missing) };
}
