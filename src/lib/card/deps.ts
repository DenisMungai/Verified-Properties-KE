import type { BillingDeps } from "@/lib/billing/deps";
import type { CardSettings } from "./config";
import type { CardGateway } from "./gateway";

/** The card flow's dependencies (prompt S6); tests pass a fake gateway. */
export interface CardDeps extends BillingDeps {
  gateway: CardGateway;
  settings: CardSettings;
}
