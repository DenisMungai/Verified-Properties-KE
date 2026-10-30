import type { JobName } from "./types";

/**
 * QStash schedules (prompt S9 decision 14). Crons are UTC; Nairobi is UTC+3 with no daylight
 * saving. About 150 deliveries a day. Registered by `npm run jobs:schedule`.
 */
export const JOB_SCHEDULES: Record<JobName, { cron: string; nairobi: string }> = {
  "grace-expiry": { cron: "5 * * * *", nairobi: "hourly at :05" },
  "plan-changes": { cron: "10 * * * *", nairobi: "hourly at :10" },
  "payment-checks": { cron: "*/15 * * * *", nairobi: "every 15 minutes" },
  "renewal-reminders": { cron: "0 4 * * *", nairobi: "07:00" },
  reconciliation: { cron: "0 22 * * *", nairobi: "01:00" },
  "storage-cleanup": { cron: "0 0 * * *", nairobi: "03:00" },
};

export const SCHEDULE_ID_PREFIX = "vpk-";

export function scheduleIdFor(job: JobName): string {
  return `${SCHEDULE_ID_PREFIX}${job}`;
}

export const JOBS_PATH = "/api/jobs";

/** Each schedule is retried this many times with QStash's backoff when the route returns 5xx. */
export const JOB_RETRIES = 3;

/** QStash can only call a public HTTPS URL. */
export function scheduleBaseUrl(raw: string): { ok: true; base: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: `Not a URL: ${raw}` };
  }
  if (url.protocol !== "https:") return { ok: false, message: "The base URL must be https:// (QStash calls it from the internet)." };
  if (["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(url.hostname)) {
    return { ok: false, message: "QStash can't reach localhost. Use your deployed URL, or test locally with npm run jobs:run." };
  }
  return { ok: true, base: url.origin };
}
