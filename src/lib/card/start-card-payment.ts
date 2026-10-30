import "server-only";
import { randomUUID } from "node:crypto";
import { insertCardPayment, recordPaymentEvent } from "@/db/queries/payments";
import type { PlanChangeKind } from "@/lib/billing/plan-change";
import { PURCHASE_MESSAGES, preparePlanInvoice, resolvePurchase, type PurchaseRefusal } from "@/lib/billing/prepare-invoice";
import { POLICIES, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { CARD_RETURN_PATH, cardReference, isPaystackCheckoutUrl } from "./config";
import type { CardDeps } from "./deps";

/**
 * Starting a card payment (prompt S6 decision 16): same eligibility, plan-change rules and open
 * invoice as M-Pesa, then Paystack Initialize after the transaction commits. The browser is sent
 * to Paystack's hosted page; card details never reach us.
 */

export type StartCardCode = PurchaseRefusal | "use_schedule" | "rate_limited" | "not_configured" | "gateway_unavailable";

export type StartCardResult =
  | { ok: true; paymentId: string; invoiceNumber: string; authorizationUrl: string; kind: PlanChangeKind }
  | { ok: false; code: StartCardCode; message: string };

export const CARD_UNAVAILABLE_MESSAGE = "Card payments are unavailable right now. Pay with M-Pesa instead.";

const MESSAGES: Record<Exclude<StartCardCode, "rate_limited">, string> = {
  ...PURCHASE_MESSAGES,
  not_configured: CARD_UNAVAILABLE_MESSAGE,
  gateway_unavailable: CARD_UNAVAILABLE_MESSAGE,
};

const fail = (code: Exclude<StartCardCode, "rate_limited">): StartCardResult => ({ ok: false, code, message: MESSAGES[code] });

export async function startCardPayment(
  deps: CardDeps | null,
  input: { userId: string; email: string; planCode: string },
): Promise<StartCardResult> {
  if (!deps) return fail("not_configured");
  const limit = await checkRateLimits([[POLICIES.paymentStartPerUser, rateLimitKey(input.userId)]], deps.rateLimiter);
  if (!limit.ok) return { ok: false, code: "rate_limited", message: tooManyAttemptsMessage(limit.retryAfterSeconds) };

  const purchase = await resolvePurchase(deps.db, input.userId, input.planCode);
  if (!purchase.ok) return fail(purchase.code);
  const prepared = await preparePlanInvoice(deps, purchase.pool, purchase.plan);
  if (!prepared.ok) return fail(prepared.code === "use_schedule" ? "use_schedule" : "gateway_unavailable");
  const { invoice } = prepared;

  const reference = cardReference(randomUUID());
  const started = await deps.gateway.initialize({
    email: input.email,
    amountKes: invoice.amountKes,
    reference,
    callbackUrl: `${deps.appUrl}${CARD_RETURN_PATH}`,
    metadata: { invoice_number: invoice.invoiceNumber },
  });

  if (!started.ok || !isPaystackCheckoutUrl(started.authorizationUrl) || started.reference !== reference) {
    const error = started.ok ? "unexpected checkout url or reference" : started.error;
    await recordPaymentEvent(deps.db, {
      eventType: "card_init_failed",
      invoiceId: invoice.id,
      payload: { reference, error, amountKes: invoice.amountKes },
    });
    console.error(`[card] init failed invoice=${invoice.invoiceNumber} reference=${reference} error=${error}`);
    return fail("gateway_unavailable");
  }

  const payment = await insertCardPayment(deps.db, { invoiceId: invoice.id, providerReference: reference, amountKes: invoice.amountKes });
  await recordPaymentEvent(deps.db, {
    eventType: "card_init",
    paymentId: payment.id,
    invoiceId: invoice.id,
    payload: { reference, amountKes: invoice.amountKes, gateway: deps.gateway.kind, mode: deps.settings.mode },
  });
  console.info(`[card] init invoice=${invoice.invoiceNumber} reference=${reference}`);
  return {
    ok: true,
    paymentId: payment.id,
    invoiceNumber: invoice.invoiceNumber,
    authorizationUrl: started.authorizationUrl,
    kind: prepared.kind,
  };
}
