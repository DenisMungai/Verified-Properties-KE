/**
 * The `jobs:run --now` fake clock (prompt S9 decision 15). A future clock against a real database
 * would pause real listings, so it needs JOBS_FAKE_CLOCK_CONFIRM=yes for that command and is
 * refused in production. Pure, for tests.
 */
export type FakeClock = { ok: true; now: Date | null } | { ok: false; message: string };

export function resolveFakeClock(
  flag: string | undefined,
  env: { JOBS_FAKE_CLOCK_CONFIRM?: string; NODE_ENV?: string },
): FakeClock {
  if (flag === undefined) return { ok: true, now: null };
  if (env.NODE_ENV === "production") return { ok: false, message: "--now is refused when NODE_ENV=production." };
  if (env.JOBS_FAKE_CLOCK_CONFIRM !== "yes") {
    return {
      ok: false,
      message:
        "--now moves the job's clock, which can pause real listings or send real reminders.\n" +
        "Run it only against a dev or test branch, with JOBS_FAKE_CLOCK_CONFIRM=yes set for this command.",
    };
  }
  const now = new Date(flag);
  if (Number.isNaN(now.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(flag)) {
    return { ok: false, message: `--now must be an ISO date-time, e.g. 2026-12-05T10:00:00Z (got "${flag}").` };
  }
  return { ok: true, now };
}
