import "server-only";
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getServerEnv } from "@/lib/env";

export interface RateLimitPolicy {
  /** Groups a policy in storage, e.g. "sign-in:email". */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Central limits (prompt S1, decision 13). */
export const POLICIES = {
  signInPerEmail: { name: "sign-in:email", limit: 5, windowSeconds: 15 * 60 },
  signInPerIp: { name: "sign-in:ip", limit: 20, windowSeconds: 15 * 60 },
  signUpPerIp: { name: "sign-up:ip", limit: 5, windowSeconds: 60 * 60 },
  resetPerEmail: { name: "reset:email", limit: 3, windowSeconds: 60 * 60 },
  resetPerIp: { name: "reset:ip", limit: 10, windowSeconds: 60 * 60 },
  resendPerEmail: { name: "resend-verification:email", limit: 3, windowSeconds: 60 * 60 },
  passwordChangePerUser: { name: "password-change:user", limit: 5, windowSeconds: 15 * 60 },
  listingCreatePerUser: { name: "listing-create:user", limit: 20, windowSeconds: 60 * 60 },
  photoUploadPerUser: { name: "photo-upload:user", limit: 80, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export interface LimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  limit(policy: RateLimitPolicy, key: string): Promise<LimitResult>;
}

/** Thrown in production when no shared limiter is configured: refuse rather than run unprotected. */
export class RateLimitUnavailableError extends Error {
  constructor() {
    super("Rate limiting is not configured (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN).");
    this.name = "RateLimitUnavailableError";
  }
}

/**
 * Identifiers such as emails are hashed so Redis never stores personal data in plain text.
 * Lower-cased first so "A@x.co" and "a@x.co" share one bucket.
 */
export function rateLimitKey(...parts: string[]): string {
  return createHash("sha256").update(parts.map((p) => p.trim().toLowerCase()).join("|")).digest("hex").slice(0, 32);
}

/** Fixed-window limiter in process memory: development and tests only (per instance). */
export function createMemoryLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async limit(policy, key) {
      const id = `${policy.name}:${key}`;
      const current = now();
      const bucket = buckets.get(id);
      if (!bucket || bucket.resetAt <= current) {
        buckets.set(id, { count: 1, resetAt: current + policy.windowSeconds * 1000 });
        return { ok: true, retryAfterSeconds: 0 };
      }
      bucket.count += 1;
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - current) / 1000));
      return bucket.count <= policy.limit ? { ok: true, retryAfterSeconds: 0 } : { ok: false, retryAfterSeconds };
    },
  };
}

function createUpstashLimiter(redis: Redis): RateLimiter {
  const limiters = new Map<string, Ratelimit>();
  return {
    async limit(policy, key) {
      let limiter = limiters.get(policy.name);
      if (!limiter) {
        limiter = new Ratelimit({
          redis,
          limiter: Ratelimit.fixedWindow(policy.limit, `${policy.windowSeconds} s`),
          prefix: `vpk:rl:${policy.name}`,
        });
        limiters.set(policy.name, limiter);
      }
      try {
        const result = await limiter.limit(key);
        return {
          ok: result.success,
          retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
        };
      } catch (error) {
        // Provider outage: fail open so sign-in keeps working; Better Auth's limiter still applies.
        console.error("[rate-limit] provider error", error instanceof Error ? error.name : "unknown");
        return { ok: true, retryAfterSeconds: 0 };
      }
    },
  };
}

let limiter: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  const env = getServerEnv();
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    limiter = createUpstashLimiter(
      new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
    );
  } else if (process.env.NODE_ENV === "production") {
    console.error("[rate-limit] refusing to run without UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
    throw new RateLimitUnavailableError();
  } else {
    limiter = createMemoryLimiter();
  }
  return limiter;
}

/** Checks every (policy, key) pair; returns the first refusal, or ok. Counts every check. */
export async function checkRateLimits(
  checks: ReadonlyArray<readonly [RateLimitPolicy, string]>,
  rateLimiter: RateLimiter = getRateLimiter(),
): Promise<LimitResult> {
  let refusal: LimitResult | undefined;
  for (const [policy, key] of checks) {
    const result = await rateLimiter.limit(policy, key);
    if (!result.ok && (!refusal || result.retryAfterSeconds > refusal.retryAfterSeconds)) refusal = result;
  }
  return refusal ?? { ok: true, retryAfterSeconds: 0 };
}

/** "Too many attempts. Try again in 12 minutes." */
export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
