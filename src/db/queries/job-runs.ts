import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { jobRuns as jr } from "@/db/schema";
import { JOB_RUN_RETENTION_DAYS } from "@/lib/notifications/constants";

/**
 * Job-run records (prompt S16 decision 8). Counts and error names only. Writers are best-effort:
 * the caller logs and carries on when recording fails.
 */

export type JobRunStatus = "running" | "ok" | "skipped" | "failed";

export interface JobRunRow {
  id: string;
  job: string;
  status: JobRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  counts: Record<string, number>;
  error: string | null;
}

const columns = {
  id: jr.id,
  job: jr.job,
  status: jr.status,
  startedAt: jr.startedAt,
  finishedAt: jr.finishedAt,
  durationMs: jr.durationMs,
  counts: jr.counts,
  error: jr.error,
};

function toRow(row: Omit<JobRunRow, "status"> & { status: string }): JobRunRow {
  return { ...row, status: row.status as JobRunStatus };
}

export async function startJobRun(db: DbExecutor, job: string, startedAt: Date): Promise<string> {
  const [row] = await db.insert(jr).values({ job, status: "running", startedAt }).returning({ id: jr.id });
  return row.id;
}

export async function finishJobRun(
  db: DbExecutor,
  id: string,
  run: { status: Exclude<JobRunStatus, "running">; finishedAt: Date; durationMs: number; counts: Record<string, number>; error?: string },
): Promise<void> {
  await db
    .update(jr)
    .set({
      status: run.status,
      finishedAt: run.finishedAt,
      durationMs: Math.max(0, Math.round(run.durationMs)),
      counts: run.counts,
      error: run.error ? run.error.slice(0, 100) : null,
    })
    .where(and(eq(jr.id, id), eq(jr.status, "running")));
}

export async function pruneJobRuns(db: DbExecutor, now: Date): Promise<number> {
  const before = new Date(now.getTime() - JOB_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(jr).where(lt(jr.startedAt, before)).returning({ id: jr.id });
  return deleted.length;
}

/** A failed run, or one that finished but counted failed items. */
const failedOrPartial = or(eq(jr.status, "failed"), and(eq(jr.status, "ok"), sql`coalesce((${jr.counts}->>'failed')::int, 0) > 0`));

export interface JobOverview {
  latest: Map<string, JobRunRow>;
  lastFinished: Map<string, Date>;
  failures: Map<string, number>;
}

/** Each job's latest run, latest finished run and failures since `since`. */
export async function jobOverview(db: DbExecutor, since: Date): Promise<JobOverview> {
  const [latest, finished, failures] = await Promise.all([
    db.selectDistinctOn([jr.job], columns).from(jr).orderBy(jr.job, desc(jr.startedAt)),
    db
      .selectDistinctOn([jr.job], { job: jr.job, finishedAt: jr.finishedAt })
      .from(jr)
      .where(and(inArray(jr.status, ["ok", "skipped"]), isNotNull(jr.finishedAt)))
      .orderBy(jr.job, desc(jr.startedAt)),
    db
      .select({ job: jr.job, n: sql<number>`count(*)::int` })
      .from(jr)
      .where(and(gte(jr.startedAt, since), failedOrPartial))
      .groupBy(jr.job),
  ]);
  return {
    latest: new Map(latest.map((row) => [row.job, toRow(row)])),
    lastFinished: new Map(finished.flatMap((row) => (row.finishedAt ? [[row.job, row.finishedAt] as const] : []))),
    failures: new Map(failures.map((row) => [row.job, row.n])),
  };
}

/** Failed or partly failed runs since `since`, newest first. */
export async function failedRuns(db: DbExecutor, since: Date, limit: number): Promise<JobRunRow[]> {
  const rows = await db
    .select(columns)
    .from(jr)
    .where(and(gte(jr.startedAt, since), failedOrPartial))
    .orderBy(desc(jr.startedAt))
    .limit(limit);
  return rows.map(toRow);
}
