import type { ServerEnv } from "@/lib/env";
import { DEFAULT_SAFARICOM_RANGES, parseCidrs, type Cidr } from "./callback-guard";

/**
 * Which M-Pesa client this deployment uses (prompt S5 decisions 2 and 3):
 * - `daraja` when the consumer key, secret, shortcode and passkey are all set
 * - `simulator` outside production when they are not
 * - `none` in production without them: payment starts are refused, never faked
 * Every mode except `none` also needs MPESA_CALLBACK_TOKEN.
 */
export type MpesaMode = "daraja" | "simulator" | "none";

export const SANDBOX_BASE_URL = "https://sandbox.safaricom.co.ke";
export const PRODUCTION_BASE_URL = "https://api.safaricom.co.ke";

/** Shown as the Paybill in simulator mode when no shortcode is set (the Daraja sandbox one). */
const SIMULATOR_SHORTCODE = "174379";

/** Callback paths avoid "mpesa", "safaricom" and "query", which Daraja rejects in C2B URLs. */
export const CALLBACK_PATHS = {
  stk: "/api/payments/stk",
  c2bValidation: "/api/payments/c2b/validation",
  c2bConfirmation: "/api/payments/c2b/confirmation",
} as const;

export interface MpesaSettings {
  mode: "daraja" | "simulator";
  environment: "sandbox" | "production";
  baseUrl: string;
  shortcode: string;
  callbackToken: string;
  callbackBaseUrl: string;
  /** null: not enforced (sandbox without MPESA_CALLBACK_ALLOWED_IPS). */
  allowedIps: Cidr[] | null;
  credentials: { consumerKey: string; consumerSecret: string; passkey: string } | null;
}

export function mpesaModeFor(env: ServerEnv, nodeEnv = process.env.NODE_ENV): MpesaMode {
  const ready = Boolean(env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_SHORTCODE && env.MPESA_PASSKEY);
  if (ready) return "daraja";
  return nodeEnv === "production" ? "none" : "simulator";
}

export function allowedIpsFor(env: ServerEnv): Cidr[] | null {
  if (env.MPESA_CALLBACK_ALLOWED_IPS) return parseCidrs(env.MPESA_CALLBACK_ALLOWED_IPS);
  return env.MPESA_ENV === "production" ? parseCidrs(DEFAULT_SAFARICOM_RANGES) : null;
}

/** Settings for the current mode, or null when M-Pesa is not usable here. */
export function mpesaSettingsFor(env: ServerEnv, nodeEnv = process.env.NODE_ENV): MpesaSettings | null {
  const mode = mpesaModeFor(env, nodeEnv);
  if (mode === "none" || !env.MPESA_CALLBACK_TOKEN) return null;
  return {
    mode,
    environment: env.MPESA_ENV,
    baseUrl: env.MPESA_ENV === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL,
    shortcode: env.MPESA_SHORTCODE ?? SIMULATOR_SHORTCODE,
    callbackToken: env.MPESA_CALLBACK_TOKEN,
    callbackBaseUrl: (env.MPESA_CALLBACK_BASE_URL ?? env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, ""),
    allowedIps: allowedIpsFor(env),
    credentials:
      mode === "daraja"
        ? {
            consumerKey: env.MPESA_CONSUMER_KEY!,
            consumerSecret: env.MPESA_CONSUMER_SECRET!,
            passkey: env.MPESA_PASSKEY!,
          }
        : null,
  };
}

export function callbackUrl(settings: MpesaSettings, path: (typeof CALLBACK_PATHS)[keyof typeof CALLBACK_PATHS]): string {
  return `${settings.callbackBaseUrl}${path}/${settings.callbackToken}`;
}
