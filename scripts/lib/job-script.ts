/**
 * Job dependencies for `jobs:run` (prompt S9 decision 15): the same jobs the QStash route runs,
 * over node-postgres, with one clock shared by every part (payments and cards included) so a fake
 * clock moves them all together.
 */
import { cardSettingsFor } from "../../src/lib/card/config";
import { createPaystackGateway } from "../../src/lib/card/paystack";
import { createTransport } from "../../src/lib/email/send";
import type { JobDeps } from "../../src/lib/jobs/types";
import { getRateLimiter } from "../../src/lib/rate-limit";
import { createSmsTransport } from "../../src/lib/sms/send";
import { getPrivateStore, getPublicStore, storageModeFor } from "../../src/lib/storage";
import type { DbExecutor } from "../../src/db/executor";
import { scriptPaymentDeps, type ScriptContext } from "./mpesa-script";

export function scriptJobDeps(ctx: ScriptContext, now: () => Date, batchSize?: number): JobDeps {
  const { env, db } = ctx;
  const withTransaction = <T>(fn: (tx: DbExecutor) => Promise<T>) => db.transaction((tx) => fn(tx as unknown as DbExecutor));
  const email = createTransport({ resendApiKey: env.RESEND_API_KEY, emailFrom: env.EMAIL_FROM });
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  const mpesa = scriptPaymentDeps(ctx);
  const cardSettings = cardSettingsFor(env);
  return {
    db,
    withTransaction,
    now,
    email,
    appUrl,
    sms: createSmsTransport({ username: env.AT_USERNAME, apiKey: env.AT_API_KEY, senderId: env.AT_SENDER_ID }),
    payments: mpesa ? { ...mpesa, now } : null,
    card: cardSettings
      ? {
          db,
          withTransaction,
          now,
          email,
          appUrl,
          rateLimiter: getRateLimiter(),
          settings: cardSettings,
          gateway: createPaystackGateway({ secretKey: cardSettings.secretKey }),
        }
      : null,
    storage: storageModeFor(env) === "none" ? null : { public: getPublicStore(), private: getPrivateStore() },
    batchSize,
  };
}
