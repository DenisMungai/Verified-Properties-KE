import { describe, expect, it } from "vitest";
import { JOB_INTERVAL_MS } from "@/lib/jobs/schedules";
import { JOB_NAMES, type JobName } from "@/lib/jobs/types";
import { DATABASE_DOWN, callbacksStalled, evaluateOps, opsBody, runOpsChecks, type JobHealth } from "./rules";

const NOW = new Date("2026-11-10T12:00:00Z");

function healthyJobs(): Map<JobName, JobHealth> {
  return new Map(JOB_NAMES.map((job) => [job, { lastFinished: new Date(NOW.getTime() - 60_000), hasRun: true, latestStatus: "ok" }]));
}

describe("ops health rules (prompt S21 decision 3)", () => {
  it("passes with fresh jobs and callbacks arriving", () => {
    const result = evaluateOps({ jobs: healthyJobs(), pushes: { pushes: 5, missing: 0 } }, NOW);
    expect(result.ok).toBe(true);
    expect(opsBody(result)).toEqual({
      status: "ok",
      checks: { database: "ok", jobs_overdue: "ok", jobs_failing: "ok", payment_callbacks: "ok" },
    });
  });

  it("names an overdue job (no finished run in twice its interval), ignoring jobs that never ran", () => {
    const jobs = healthyJobs();
    const [first, second] = JOB_NAMES;
    jobs.set(first, { lastFinished: new Date(NOW.getTime() - 2 * JOB_INTERVAL_MS[first] - 1), hasRun: true, latestStatus: "ok" });
    jobs.set(second, { lastFinished: undefined, hasRun: false, latestStatus: undefined });
    const result = evaluateOps({ jobs, pushes: { pushes: 0, missing: 0 } }, NOW);
    expect(result.checks.jobs_overdue).toBe("fail");
    expect(result.overdueJobs).toEqual([first]);
    expect(opsBody(result)).toMatchObject({ status: "fail", overdueJobs: [first] });
  });

  it("names a job whose latest run failed", () => {
    const jobs = healthyJobs();
    const job = JOB_NAMES[2];
    jobs.set(job, { ...jobs.get(job)!, latestStatus: "failed" });
    const result = evaluateOps({ jobs, pushes: { pushes: 0, missing: 0 } }, NOW);
    expect(result.checks.jobs_failing).toBe("fail");
    expect(result.failingJobs).toEqual([job]);
  });

  it("flags stalled callbacks only with enough pushes and enough missing", () => {
    expect(callbacksStalled({ pushes: 0, missing: 0 })).toBe(false);
    expect(callbacksStalled({ pushes: 1, missing: 1 })).toBe(false);
    expect(callbacksStalled({ pushes: 2, missing: 2 })).toBe(true);
    expect(callbacksStalled({ pushes: 3, missing: 2 })).toBe(true);
    expect(callbacksStalled({ pushes: 5, missing: 2 })).toBe(false);
    expect(callbacksStalled({ pushes: 10, missing: 1 })).toBe(false);
  });

  it("reports only the database when reads fail", async () => {
    const failing = async () => {
      throw new Error("connection refused");
    };
    expect(await runOpsChecks({ readJobs: failing, readPushStats: failing }, NOW)).toEqual(DATABASE_DOWN);
    expect(opsBody(DATABASE_DOWN)).toMatchObject({ status: "fail", checks: { database: "fail" } });
  });

  it("never puts more than names in the body", () => {
    const jobs = healthyJobs();
    jobs.set(JOB_NAMES[0], { ...jobs.get(JOB_NAMES[0])!, latestStatus: "failed" });
    const body = JSON.stringify(opsBody(evaluateOps({ jobs, pushes: { pushes: 4, missing: 4 } }, NOW)));
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["checks", "failingJobs", "status"]);
  });
});
