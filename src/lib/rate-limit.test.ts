import { describe, expect, it } from "vitest";
import {
  POLICIES,
  checkRateLimits,
  createMemoryLimiter,
  rateLimitKey,
  tooManyAttemptsMessage,
} from "./rate-limit";

describe("rateLimitKey", () => {
  it("is stable, case-insensitive and does not contain the raw email", () => {
    const a = rateLimitKey("Wanjiru@Example.com");
    expect(a).toBe(rateLimitKey("wanjiru@example.com "));
    expect(a).not.toContain("wanjiru");
    expect(a).toHaveLength(32);
  });

  it("separates different parts", () => {
    expect(rateLimitKey("1.2.3.4", "a@b.co")).not.toBe(rateLimitKey("1.2.3.4a", "@b.co"));
  });
});

describe("memory limiter", () => {
  it("allows the limit, refuses the next attempt, then resets after the window", async () => {
    let now = 0;
    const limiter = createMemoryLimiter(() => now);
    const policy = POLICIES.signInPerEmail; // 5 per 15 minutes
    for (let i = 0; i < 5; i++) expect((await limiter.limit(policy, "k")).ok).toBe(true);

    const sixth = await limiter.limit(policy, "k");
    expect(sixth.ok).toBe(false);
    expect(sixth.retryAfterSeconds).toBe(15 * 60);

    now += 15 * 60 * 1000;
    expect((await limiter.limit(policy, "k")).ok).toBe(true);
  });

  it("keeps keys and policies independent", async () => {
    const limiter = createMemoryLimiter(() => 0);
    for (let i = 0; i < 5; i++) await limiter.limit(POLICIES.signInPerEmail, "a");
    expect((await limiter.limit(POLICIES.signInPerEmail, "b")).ok).toBe(true);
    expect((await limiter.limit(POLICIES.signInPerIp, "a")).ok).toBe(true);
  });
});

describe("checkRateLimits", () => {
  it("returns the longest refusal across checks", async () => {
    let now = 0;
    const limiter = createMemoryLimiter(() => now);
    for (let i = 0; i < 5; i++) await limiter.limit(POLICIES.signInPerEmail, "e");
    now = 60_000;
    const result = await checkRateLimits(
      [
        [POLICIES.signInPerEmail, "e"],
        [POLICIES.signInPerIp, "ip"],
      ],
      limiter,
    );
    expect(result.ok).toBe(false);
    expect(result.retryAfterSeconds).toBe(14 * 60);
  });

  it("counts every check, including the ones after a refusal", async () => {
    const calls: string[] = [];
    const limiter = {
      async limit(policy: { name: string }, key: string) {
        calls.push(`${policy.name}:${key}`);
        return policy.name === POLICIES.signInPerEmail.name ? { ok: false, retryAfterSeconds: 60 } : { ok: true, retryAfterSeconds: 0 };
      },
    };
    const result = await checkRateLimits(
      [
        [POLICIES.signInPerEmail, "e"],
        [POLICIES.signInPerIp, "ip"],
      ],
      limiter,
    );
    expect(result).toEqual({ ok: false, retryAfterSeconds: 60 });
    expect(calls.sort()).toEqual(["sign-in:email:e", "sign-in:ip:ip"]);
  });
});

describe("tooManyAttemptsMessage", () => {
  it("rounds up to whole minutes", () => {
    expect(tooManyAttemptsMessage(30)).toBe("Too many attempts. Try again in 1 minute.");
    expect(tooManyAttemptsMessage(14 * 60 + 1)).toBe("Too many attempts. Try again in 15 minutes.");
  });
});

describe("messaging limits (prompt S15 decision 15)", () => {
  it("allows 60 messages an hour per user, then refuses", async () => {
    const limiter = createMemoryLimiter(() => 0);
    for (let i = 0; i < 60; i++) expect((await limiter.limit(POLICIES.messagePerUser, "u")).ok).toBe(true);
    expect((await limiter.limit(POLICIES.messagePerUser, "u")).ok).toBe(false);
  });

  it("sets report, block and poll limits", () => {
    expect(POLICIES.messageReportPerUser).toMatchObject({ limit: 10, windowSeconds: 3600 });
    expect(POLICIES.blockPerUser).toMatchObject({ limit: 20, windowSeconds: 3600 });
    expect(POLICIES.messagePollPerUser).toMatchObject({ limit: 600, windowSeconds: 3600 });
  });
});
