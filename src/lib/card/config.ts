import type { ServerEnv } from "@/lib/env";
import { parseCidrs, type Cidr } from "@/lib/mpesa/callback-guard";

/**
 * Card payments through Paystack (prompt S6 decisions 14 and 17).
 * - No key: cards are off and the checkout shows M-Pesa only. There is no card simulator.
 * - A test key in production is refused, never used.
 */

export const PAYSTACK_BASE_URL = "https://api.paystack.co";

/** Paystack's published webhook source IPs (test and live). */
export const PAYSTACK_WEBHOOK_IPS = "52.31.139.75,52.49.173.169,52.214.14.220";

/** Hosted checkout pages; the browser is only ever sent here. */
export const PAYSTACK_CHECKOUT_ORIGIN = "https://checkout.paystack.com";

export const CARD_WEBHOOK_PATH = "/api/payments/card/webhook";
export const CARD_RETURN_PATH = "/account/billing/checkout/card-return";

export interface CardSettings {
  mode: "test" | "live";
  secretKey: string;
  /** null: not enforced (test key without PAYSTACK_WEBHOOK_ALLOWED_IPS). */
  allowedIps: Cidr[] | null;
}

export function cardSettingsFor(env: ServerEnv, nodeEnv = process.env.NODE_ENV): CardSettings | null {
  const key = env.PAYSTACK_SECRET_KEY;
  if (!key) return null;
  const mode = key.startsWith("sk_live_") ? "live" : "test";
  if (mode === "test" && nodeEnv === "production") {
    console.error("[card] test key in production");
    return null;
  }
  const list = env.PAYSTACK_WEBHOOK_ALLOWED_IPS ?? (mode === "live" ? PAYSTACK_WEBHOOK_IPS : null);
  return { mode, secretKey: key, allowedIps: list ? parseCidrs(list, "PAYSTACK_WEBHOOK_ALLOWED_IPS") : null };
}

/** Only Paystack's hosted checkout is an acceptable redirect target. */
export function isPaystackCheckoutUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === PAYSTACK_CHECKOUT_ORIGIN && parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Our card references: "VPKC-" + the payment's uuid. Letters, digits and "-" only (Paystack rule). */
export const CARD_REFERENCE_PATTERN = /^VPKC-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function cardReference(paymentKey: string): string {
  return `VPKC-${paymentKey}`;
}
