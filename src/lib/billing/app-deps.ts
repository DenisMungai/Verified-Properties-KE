import "server-only";
import { getDb } from "@/db";
import { withTransaction } from "@/db/tx";
import { createTransport, type EmailTransport } from "@/lib/email/send";
import { getServerEnv } from "@/lib/env";
import { getRateLimiter } from "@/lib/rate-limit";
import type { BillingDeps } from "./deps";

let email: EmailTransport | undefined;

/** The app's shared billing dependencies; M-Pesa and card deps build on these. */
export function getBillingDeps(): BillingDeps {
  const env = getServerEnv();
  email ??= createTransport({ resendApiKey: env.RESEND_API_KEY, emailFrom: env.EMAIL_FROM });
  return {
    db: getDb(),
    withTransaction,
    now: () => new Date(),
    rateLimiter: getRateLimiter(),
    email,
    appUrl: env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, ""),
  };
}
