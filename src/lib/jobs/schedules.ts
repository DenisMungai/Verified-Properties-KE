import type { JobName } from "./types";

/**
 * QStash schedules (prompt S9 decision 14). Crons are UTC; Nairobi is UTC+3 with no daylight
 * saving. About 440 deliveries a day since S16 (288 of them `notifications`), within QStash's free
 * 1,000 a day. Registered by `npm run jobs:schedule`.
 */
export const JOB_SCHEDULES: Record<JobName, { cron: string; nairobi: string }> = {
  "grace-expiry": { cron: "5 * * * *", nairobi: "hourly at :05" },
  "plan-changes": { cron: "10 * * * *", nairobi: "hourly at :10" },
  "payment-checks": { cron: "*/15 * * * *", nairobi: "every 15 minutes" },
  "renewal-reminders": { cron: "0 4 * * *", nairobi: "07:00" },
  reconciliation: { cron: "0 22 * * *", nairobi: "01:00" },
  "storage-cleanup": { cron: "0 0 * * *", nairobi: "03:00" },
  "verification-lifecycle": { cron: "5 4 * * *", nairobi: "07:05" },
  notifications: { cron: "*/5 * * * *", nairobi: "every 5 minutes" },
  "review-reminders": { cron: "0 5 * * *", nairobi: "08:00" },
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** How often each job runs, for the admin page's "Overdue" check (2× this with no finished run). */
export const JOB_INTERVAL_MS: Record<JobName, number> = {
  "grace-expiry": HOUR,
  "plan-changes": HOUR,
  "payment-checks": 15 * MINUTE,
  "renewal-reminders": 24 * HOUR,
  reconciliation: 24 * HOUR,
  "storage-cleanup": 24 * HOUR,
  "verification-lifecycle": 24 * HOUR,
  notifications: 5 * MINUTE,
  "review-reminders": 24 * HOUR,
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
