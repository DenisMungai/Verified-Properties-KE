import type { BillingDeps } from "@/lib/billing/deps";
import type { DarajaClient } from "./client";
import type { MpesaSettings } from "./config";

/**
 * Everything the M-Pesa flow needs from the outside world (prompt S5). The app builds it in
 * `index.ts`; integration tests pass the test branch, a fake Daraja client and a fixed clock.
 */
export interface PaymentDeps extends BillingDeps {
  daraja: DarajaClient;
  settings: MpesaSettings;
  /** Waits between STK Query attempts; tests pass a no-op. */
  sleep: (ms: number) => Promise<void>;
}
