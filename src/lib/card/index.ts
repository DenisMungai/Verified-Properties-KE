import "server-only";
import { getBillingDeps } from "@/lib/billing/app-deps";
import { getServerEnv } from "@/lib/env";
import { cardSettingsFor, type CardSettings } from "./config";
import type { CardDeps } from "./deps";
import type { CardGateway } from "./gateway";
import { createPaystackGateway } from "./paystack";

let gateway: CardGateway | undefined;

/** Card settings, or null when cards are off here (no key, or a test key in production). */
export function getCardSettings(): CardSettings | null {
  return cardSettingsFor(getServerEnv());
}

export function cardPaymentsEnabled(): boolean {
  return getCardSettings() !== null;
}

export function getCardDeps(): CardDeps | null {
  const settings = getCardSettings();
  if (!settings) return null;
  gateway ??= createPaystackGateway({ secretKey: settings.secretKey });
  return { ...getBillingDeps(), gateway, settings };
}
