/**
 * Operator: register the QStash schedules for the background jobs (prompt S9 decision 14).
 * Creates each one or updates it in place (fixed ids `vpk-<job>`), and deletes `vpk-*` schedules
 * no longer in the registry. Needs QSTASH_TOKEN; never prints it.
 *
 *   npm run jobs:schedule -- --base-url https://your-app.vercel.app
 *   npm run jobs:schedule -- --list
 *
 * --base-url defaults to NEXT_PUBLIC_APP_URL. QStash must reach it over HTTPS, so localhost is refused.
 */
import { Client } from "@upstash/qstash";
import { parseServerEnv } from "../src/lib/env";
import { JOB_RETRIES, JOB_SCHEDULES, JOBS_PATH, SCHEDULE_ID_PREFIX, scheduleBaseUrl, scheduleIdFor } from "../src/lib/jobs/schedules";
import { JOB_NAMES } from "../src/lib/jobs/types";
import { parseArgs, run } from "./lib/mpesa-script";

run("jobs-schedule", async () => {
  const env = parseServerEnv(process.env);
  const { flags } = parseArgs(process.argv.slice(2));
  const target = flags.list ? null : scheduleBaseUrl(flags["base-url"] ?? env.NEXT_PUBLIC_APP_URL);
  if (target && !target.ok) {
    console.error(target.message);
    return 1;
  }
  if (!env.QSTASH_TOKEN) {
    console.error("QSTASH_TOKEN is not set. Copy it from the Upstash console (QStash) into .env.local.");
    return 1;
  }
  const client = new Client({ token: env.QSTASH_TOKEN, ...(env.QSTASH_URL ? { baseUrl: env.QSTASH_URL } : {}) });

  const existing = await client.schedules.list();
  const ours = existing.filter((s) => s.scheduleId.startsWith(SCHEDULE_ID_PREFIX));
  if (!target) {
    console.table(ours.map((s) => ({ id: s.scheduleId, cron: s.cron, destination: s.destination, paused: s.isPaused })));
    return 0;
  }

  const rows = [];
  for (const job of JOB_NAMES) {
    const { cron, nairobi } = JOB_SCHEDULES[job];
    const destination = `${target.base}${JOBS_PATH}/${job}`;
    const { scheduleId } = await client.schedules.create({
      scheduleId: scheduleIdFor(job),
      destination,
      cron,
      method: "POST",
      retries: JOB_RETRIES,
    });
    rows.push({ id: scheduleId, cron, nairobi, destination });
  }
  const wanted = new Set(JOB_NAMES.map(scheduleIdFor));
  for (const stale of ours.filter((s) => !wanted.has(s.scheduleId))) {
    await client.schedules.delete(stale.scheduleId);
    console.info(`Deleted stale schedule ${stale.scheduleId}`);
  }
  console.table(rows);
  return 0;
});
