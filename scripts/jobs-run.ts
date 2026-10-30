/**
 * Dev / operator: run one background job now, without QStash (prompt S9 decision 15). Same code
 * as the QStash route.
 *
 *   npm run jobs:run -- reconciliation
 *   npm run jobs:run -- grace-expiry --batch 20
 *   JOBS_FAKE_CLOCK_CONFIRM=yes npm run jobs:run -- grace-expiry --now 2026-12-05T10:00:00Z
 *   PowerShell: $env:JOBS_FAKE_CLOCK_CONFIRM="yes"; npm run jobs:run -- grace-expiry --now 2026-12-05T10:00:00Z
 *
 * --now moves the job's clock (S11's forced lapse). Use it only against a dev or test branch.
 */
import { resolveFakeClock } from "../src/lib/jobs/fake-clock";
import { runJob } from "../src/lib/jobs/registry";
import { isJobName, JOB_NAMES } from "../src/lib/jobs/types";
import { scriptJobDeps } from "./lib/job-script";
import { openScriptContext, parseArgs, run } from "./lib/mpesa-script";

run("jobs-run", async () => {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [name] = positional;
  if (!name || !isJobName(name)) {
    console.error(`Usage: npm run jobs:run -- <${JOB_NAMES.join("|")}> [--now <ISO>] [--batch <n>]`);
    return 1;
  }
  const clock = resolveFakeClock(flags.now, process.env);
  if (!clock.ok) {
    console.error(clock.message);
    return 1;
  }
  const batch = flags.batch === undefined ? undefined : Number(flags.batch);
  if (batch !== undefined && (!Number.isInteger(batch) || batch < 1 || batch > 1000)) {
    console.error("--batch must be a whole number from 1 to 1000.");
    return 1;
  }

  const fixed = clock.now;
  if (fixed) console.info(`Fake clock: ${fixed.toISOString()}`);
  const ctx = openScriptContext();
  try {
    const summary = await runJob(name, scriptJobDeps(ctx, fixed ? () => fixed : () => new Date(), batch));
    console.info(`\n${summary.job}: ${summary.status} in ${summary.durationMs} ms`);
    console.table(Object.keys(summary.counts).length > 0 ? summary.counts : { nothingToDo: 0 });
    for (const [check, ids] of Object.entries(summary.ids ?? {})) console.info(`${check}: ${ids.join(", ")}`);
    return summary.counts.failed ? 1 : 0;
  } finally {
    await ctx.close();
  }
});
