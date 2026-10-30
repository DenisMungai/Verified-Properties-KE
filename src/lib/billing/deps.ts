import type { DbExecutor } from "@/db/executor";
import type { EmailTransport } from "@/lib/email/send";
import type { RateLimiter } from "@/lib/rate-limit";

/**
 * What every payment method needs from the outside world (prompts S5, S6). M-Pesa and card deps
 * extend it; integration tests pass the test branch, a fixed clock and a recording transport.
 */
export interface BillingDeps {
  db: DbExecutor;
  /** Runs `fn` in one database transaction. */
  withTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  now: () => Date;
  rateLimiter: RateLimiter;
  /** Receipt emails. */
  email: EmailTransport;
  /** Absolute base for links in emails, without a trailing slash. */
  appUrl: string;
}
