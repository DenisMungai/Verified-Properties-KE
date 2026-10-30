import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveFakeClock } from "./fake-clock";
import { handleJobRequest } from "./handle-request";
import { startOfNairobiDay } from "./reconciliation";
import { reminderDue } from "./reminder-window";
import { JOB_SCHEDULES, scheduleBaseUrl, scheduleIdFor } from "./schedules";
import { verifyQstashSignature, type SigningKeys } from "./signature";
import { JOB_NAMES, type JobDeps } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe("reminderDue", () => {
  const end = new Date("2026-12-10T09:00:00Z");
  const at = (msBefore: number) => new Date(end.getTime() - msBefore);

  it("sends nothing more than 5 days out, or after the end", () => {
    expect(reminderDue(end, at(5 * DAY + 1))).toBeNull();
    expect(reminderDue(end, at(0))).toBeNull();
    expect(reminderDue(end, at(-HOUR))).toBeNull();
  });

  it("is 5d from 5 days down to just over 1 day, then 1d", () => {
    expect(reminderDue(end, at(5 * DAY))).toBe("5d");
    expect(reminderDue(end, at(4.5 * DAY))).toBe("5d");
    expect(reminderDue(end, at(DAY + 1))).toBe("5d");
    expect(reminderDue(end, at(DAY))).toBe("1d");
    expect(reminderDue(end, at(HOUR))).toBe("1d");
  });
});

describe("startOfNairobiDay", () => {
  it("returns 21:00 UTC of the previous UTC day (Nairobi midnight)", () => {
    expect(startOfNairobiDay(new Date("2026-12-05T10:00:00Z")).toISOString()).toBe("2026-12-04T21:00:00.000Z");
    // 22:30 UTC is already 01:30 the next day in Nairobi.
    expect(startOfNairobiDay(new Date("2026-12-05T22:30:00Z")).toISOString()).toBe("2026-12-05T21:00:00.000Z");
    expect(startOfNairobiDay(new Date("2026-12-05T21:00:00Z")).toISOString()).toBe("2026-12-05T21:00:00.000Z");
  });
});

describe("schedules", () => {
  it("has a 5-field cron and a vpk- id for every job", () => {
    for (const job of JOB_NAMES) {
      expect(JOB_SCHEDULES[job].cron.split(" ")).toHaveLength(5);
      expect(scheduleIdFor(job)).toBe(`vpk-${job}`);
    }
  });

  it("refuses http and localhost destinations", () => {
    expect(scheduleBaseUrl("http://localhost:3000").ok).toBe(false);
    expect(scheduleBaseUrl("https://localhost:3000").ok).toBe(false);
    expect(scheduleBaseUrl("http://app.example.co.ke").ok).toBe(false);
    expect(scheduleBaseUrl("not a url").ok).toBe(false);
    expect(scheduleBaseUrl("https://app.example.co.ke/some/path")).toEqual({ ok: true, base: "https://app.example.co.ke" });
  });
});

describe("resolveFakeClock", () => {
  it("uses the real clock without --now", () => {
    expect(resolveFakeClock(undefined, {})).toEqual({ ok: true, now: null });
  });

  it("needs JOBS_FAKE_CLOCK_CONFIRM=yes and refuses production", () => {
    expect(resolveFakeClock("2026-12-05T10:00:00Z", {}).ok).toBe(false);
    expect(resolveFakeClock("2026-12-05T10:00:00Z", { JOBS_FAKE_CLOCK_CONFIRM: "yes", NODE_ENV: "production" }).ok).toBe(false);
    expect(resolveFakeClock("2026-12-05T10:00:00Z", { JOBS_FAKE_CLOCK_CONFIRM: "yes" })).toEqual({
      ok: true,
      now: new Date("2026-12-05T10:00:00Z"),
    });
  });

  it("rejects anything but an ISO date-time", () => {
    expect(resolveFakeClock("tomorrow", { JOBS_FAKE_CLOCK_CONFIRM: "yes" }).ok).toBe(false);
    expect(resolveFakeClock("2026-12-05", { JOBS_FAKE_CLOCK_CONFIRM: "yes" }).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Signatures and the route logic                                             */
/* -------------------------------------------------------------------------- */

const KEYS: SigningKeys = { current: "sig_current_test_key", next: "sig_next_test_key" };

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** A QStash-style JWT: HS256, issuer Upstash, body = base64url(sha256(body)). */
function qstashJwt(key: string, body: string, { expiresIn = 300 }: { expiresIn?: number } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: "Upstash",
      sub: "https://app.example/api/jobs/reconciliation",
      iat: now,
      nbf: now,
      exp: now + expiresIn,
      jti: "test",
      body: b64url(createHash("sha256").update(body).digest()),
    }),
  );
  const signature = b64url(createHmac("sha256", key).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

describe("verifyQstashSignature", () => {
  it("accepts the current or the next key over the exact body", async () => {
    expect(await verifyQstashSignature(KEYS, qstashJwt(KEYS.current, "{}"), "{}")).toBe("ok");
    expect(await verifyQstashSignature(KEYS, qstashJwt(KEYS.next, "{}"), "{}")).toBe("ok");
  });

  it("rejects a missing, foreign, expired or body-mismatched signature", async () => {
    expect(await verifyQstashSignature(KEYS, null, "{}")).toBe("invalid");
    expect(await verifyQstashSignature(KEYS, qstashJwt("someone_else", "{}"), "{}")).toBe("invalid");
    expect(await verifyQstashSignature(KEYS, qstashJwt(KEYS.current, "{}", { expiresIn: -60 }), "{}")).toBe("invalid");
    expect(await verifyQstashSignature(KEYS, qstashJwt(KEYS.current, "{}"), '{"tampered":true}')).toBe("invalid");
  });

  it("is not configured without keys", async () => {
    expect(await verifyQstashSignature(null, qstashJwt(KEYS.current, ""), "")).toBe("not_configured");
  });
});

describe("handleJobRequest", () => {
  /** Never reached unless the signature passes; storage null makes storage-cleanup a no-op. */
  const deps = (): JobDeps =>
    ({
      now: () => new Date(),
      storage: null,
    }) as unknown as JobDeps;

  const post = (job: string, signature?: string, body = "") =>
    handleJobRequest(
      new Request(`https://app.example/api/jobs/${job}`, {
        method: "POST",
        body,
        headers: signature ? { "Upstash-Signature": signature } : {},
      }),
      job,
      { keys: KEYS, deps },
    );

  it("404s an unknown job before checking anything", async () => {
    expect((await post("nope", qstashJwt(KEYS.current, ""))).status).toBe(404);
  });

  it("503s without keys and 401s without a valid signature", async () => {
    const noKeys = await handleJobRequest(new Request("https://app.example/api/jobs/storage-cleanup", { method: "POST" }), "storage-cleanup", {
      keys: null,
      deps,
    });
    expect(noKeys.status).toBe(503);
    expect((await post("storage-cleanup")).status).toBe(401);
    expect((await post("storage-cleanup", qstashJwt(KEYS.current, "a"), "b")).status).toBe(401);
  });

  it("runs the job for a valid signature and returns its summary", async () => {
    const response = await post("storage-cleanup", qstashJwt(KEYS.current, ""));
    expect(response.status).toBe(200);
    const summary = (await response.json()) as { job: string; status: string };
    expect(summary).toMatchObject({ job: "storage-cleanup", status: "skipped" });
  });

  it("returns 500 without details when the job throws", async () => {
    const broken = (): JobDeps => {
      throw new Error("db down: postgres://secret@host");
    };
    const response = await handleJobRequest(
      new Request("https://app.example/api/jobs/reconciliation", { method: "POST", headers: { "Upstash-Signature": qstashJwt(KEYS.current, "") } }),
      "reconciliation",
      { keys: KEYS, deps: broken },
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });
});
