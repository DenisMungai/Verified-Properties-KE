import "server-only";
import { hasRecentPendingStk, insertStkPayment, recordPaymentEvent } from "@/db/queries/payments";
import type { PlanChangeKind } from "@/lib/billing/plan-change";
import { PURCHASE_MESSAGES, preparePlanInvoice, resolvePurchase, type PurchaseRefusal } from "@/lib/billing/prepare-invoice";
import { formatKes } from "@/lib/format";
import { maskPhone, normalizeKenyanPhone } from "@/lib/kenya";
import { POLICIES, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { CALLBACK_PATHS, callbackUrl } from "./config";
import type { PaymentDeps } from "./deps";

/**
 * Starting an M-Pesa payment for a listing plan (prompt S5 decision 5; plan changes from prompt
 * S6 decision 2). The price, plan and owner all come from the database; the caller supplies only
 * a plan code and a phone number. The subscription and invoice are prepared in one transaction;
 * the STK Push is sent after it commits, because a network call never sits inside a transaction.
 */

/** A second STK request for the same invoice is refused for this long. */
export const IN_FLIGHT_SECONDS = 90;

/** TransactionDesc is limited to 13 characters. */
const DESCRIPTION_MAX = 13;

export type StartPaymentCode =
  | "invalid_phone"
  | "rate_limited"
  | PurchaseRefusal
  | "use_schedule"
  | "in_flight"
  | "not_configured"
  | "daraja_rejected";

export type StartPaymentResult =
  | {
      ok: true;
      paymentId: string;
      invoiceNumber: string;
      amountKes: number;
      planName: string;
      paybill: string;
      checkoutRequestId: string;
      kind: PlanChangeKind;
    }
  | { ok: false; code: StartPaymentCode; message: string; invoiceNumber?: string; paybill?: string };

export const NOT_CONFIGURED_MESSAGE = "M-Pesa payments are not set up yet.";

const MESSAGES: Record<Exclude<StartPaymentCode, "rate_limited" | "daraja_rejected">, string> = {
  ...PURCHASE_MESSAGES,
  invalid_phone: "Enter a Kenyan M-Pesa number, like 0712 345 678.",
  in_flight: "We've already sent a payment request to your phone. Check your phone, or try again in a minute.",
  not_configured: NOT_CONFIGURED_MESSAGE,
};

function fail(code: Exclude<StartPaymentCode, "rate_limited" | "daraja_rejected">): StartPaymentResult {
  return { ok: false, code, message: MESSAGES[code] };
}

export async function startPlanPayment(
  deps: PaymentDeps | null,
  input: { userId: string; planCode: string; phone: string },
): Promise<StartPaymentResult> {
  if (!deps) return fail("not_configured");
  const phone = normalizeKenyanPhone(input.phone);
  if (!phone) return fail("invalid_phone");

  const limit = await checkRateLimits(
    [
      [POLICIES.paymentStartPerUser, rateLimitKey(input.userId)],
      [POLICIES.paymentStartPerPhone, rateLimitKey(phone.e164)],
    ],
    deps.rateLimiter,
  );
  if (!limit.ok) return { ok: false, code: "rate_limited", message: tooManyAttemptsMessage(limit.retryAfterSeconds) };

  const purchase = await resolvePurchase(deps.db, input.userId, input.planCode);
  if (!purchase.ok) return fail(purchase.code);
  const { pool, plan } = purchase;

  const prepared = await preparePlanInvoice(deps, pool, plan, (tx, invoice, now) =>
    hasRecentPendingStk(tx, invoice.id, new Date(now.getTime() - IN_FLIGHT_SECONDS * 1000)),
  );
  if (!prepared.ok) return fail(prepared.code);
  const { invoice } = prepared;
  const { shortcode } = deps.settings;

  const pushed = await deps.daraja.stkPush({
    phoneDaraja: phone.daraja,
    amountKes: invoice.amountKes,
    accountReference: invoice.invoiceNumber,
    description: plan.name.slice(0, DESCRIPTION_MAX),
    callbackUrl: callbackUrl(deps.settings, CALLBACK_PATHS.stk),
  });

  if (!pushed.ok) {
    await recordPaymentEvent(deps.db, {
      eventType: "stk_push_failed",
      invoiceId: invoice.id,
      payload: { error: pushed.error, phone: maskPhone(phone.e164), amountKes: invoice.amountKes },
    });
    console.error(`[mpesa] stk push failed invoice=${invoice.invoiceNumber} phone=${maskPhone(phone.e164)} error=${pushed.error}`);
    return {
      ok: false,
      code: "daraja_rejected",
      message: `M-Pesa couldn't start the payment. Try again, or pay ${formatKes(invoice.amountKes)} to Paybill ${shortcode}, account ${invoice.invoiceNumber}.`,
      invoiceNumber: invoice.invoiceNumber,
      paybill: shortcode,
    };
  }

  const payment = await insertStkPayment(deps.db, {
    invoiceId: invoice.id,
    phoneE164: phone.e164,
    checkoutRequestId: pushed.checkoutRequestId,
    merchantRequestId: pushed.merchantRequestId,
    amountKes: invoice.amountKes,
  });
  await recordPaymentEvent(deps.db, {
    eventType: "stk_push",
    paymentId: payment.id,
    invoiceId: invoice.id,
    payload: {
      checkoutRequestId: pushed.checkoutRequestId,
      merchantRequestId: pushed.merchantRequestId,
      phone: maskPhone(phone.e164),
      amountKes: invoice.amountKes,
      accountReference: invoice.invoiceNumber,
      client: deps.daraja.kind,
    },
  });
  console.info(
    `[mpesa] stk push sent invoice=${invoice.invoiceNumber} checkout=${pushed.checkoutRequestId} phone=${maskPhone(phone.e164)}`,
  );

  return {
    ok: true,
    paymentId: payment.id,
    invoiceNumber: invoice.invoiceNumber,
    amountKes: invoice.amountKes,
    planName: plan.name,
    paybill: shortcode,
    checkoutRequestId: pushed.checkoutRequestId,
    kind: prepared.kind,
  };
}
