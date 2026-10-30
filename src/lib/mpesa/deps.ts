import type { DbExecutor } from "@/db/executor";
import type { RateLimiter } from "@/lib/rate-limit";
import type { DarajaClient } from "./client";
import type { MpesaSettings } from "./config";

/**
 * Everything the payment flow needs from the outside world (prompt S5). The app builds it in
 * `index.ts`; integration tests pass the test branch, a fake Daraja client and a fixed clock.
 */
export interface PaymentDeps {
  db: DbExecutor;
  /** Runs `fn` in one database transaction. */
  withTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  daraja: DarajaClient;
  settings: MpesaSettings;
  now: () => Date;
  rateLimiter: RateLimiter;
  /** Waits between STK Query attempts; tests pass a no-op. */
  sleep: (ms: number) => Promise<void>;
}
