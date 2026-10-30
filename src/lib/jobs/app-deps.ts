import "server-only";
import { getBillingDeps } from "@/lib/billing/app-deps";
import { getCardDeps } from "@/lib/card";
import { getServerEnv } from "@/lib/env";
import { getPaymentDeps } from "@/lib/mpesa";
import { createSmsTransport, type SmsTransport } from "@/lib/sms/send";
import { getPrivateStore, getPublicStore, getStorageMode } from "@/lib/storage";
import { signingKeysFrom, type SigningKeys } from "./signature";
import type { JobDeps } from "./types";

let sms: SmsTransport | undefined;

/** The app's job dependencies. A missing optional service is null, never an exception. */
export function getJobDeps(): JobDeps {
  const env = getServerEnv();
  const billing = getBillingDeps();
  sms ??= createSmsTransport({ username: env.AT_USERNAME, apiKey: env.AT_API_KEY, senderId: env.AT_SENDER_ID });
  return {
    db: billing.db,
    withTransaction: billing.withTransaction,
    now: billing.now,
    email: billing.email,
    appUrl: billing.appUrl,
    sms,
    payments: getPaymentDeps(),
    card: getCardDeps(),
    storage: getStorageMode() === "none" ? null : { public: getPublicStore(), private: getPrivateStore() },
  };
}

export function getSigningKeys(): SigningKeys | null {
  return signingKeysFrom(getServerEnv());
}
