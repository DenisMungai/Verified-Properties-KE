import "server-only";
import { getDb } from "@/db";
import { storedStkResult } from "@/db/queries/payments";
import { withTransaction } from "@/db/tx";
import { getServerEnv } from "@/lib/env";
import { getRateLimiter } from "@/lib/rate-limit";
import type { DarajaClient } from "./client";
import { mpesaSettingsFor, type MpesaSettings } from "./config";
import { createDarajaClient } from "./daraja";
import type { PaymentDeps } from "./deps";
import { createSimulatorClient } from "./simulator";

/**
 * The app's payment dependencies, or null when M-Pesa is not set up here (production without
 * Daraja credentials, or no MPESA_CALLBACK_TOKEN). Callers turn null into "not set up yet".
 */

let client: DarajaClient | undefined;

export function getMpesaSettings(): MpesaSettings | null {
  return mpesaSettingsFor(getServerEnv());
}

function createClient(settings: MpesaSettings): DarajaClient {
  if (settings.mode === "daraja" && settings.credentials) {
    return createDarajaClient({
      baseUrl: settings.baseUrl,
      shortcode: settings.shortcode,
      ...settings.credentials,
    });
  }
  return createSimulatorClient((checkoutRequestId) => storedStkResult(getDb(), checkoutRequestId));
}

export function getPaymentDeps(): PaymentDeps | null {
  const settings = getMpesaSettings();
  if (!settings) {
    console.error("[mpesa] not configured");
    return null;
  }
  client ??= createClient(settings);
  return {
    db: getDb(),
    withTransaction,
    daraja: client,
    settings,
    now: () => new Date(),
    rateLimiter: getRateLimiter(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
