import "server-only";
import { and, eq } from "drizzle-orm";
import { getPayment, recordPaymentEvent, type Payment } from "@/db/queries/payments";
import { payments } from "@/db/schema";
import { receiptAfterConfirm } from "@/lib/billing/receipts";
import { closePayment, confirmPayment, type ConfirmOutcome } from "@/lib/mpesa/confirm";
import type { CardDeps } from "./deps";

/**
 * Settling a card payment (prompt S6 decision 16). Neither the redirect nor the webhook is
 * trusted: Paystack's Verify must report success in KES for exactly the invoice amount.
 *
 * A declined or abandoned attempt leaves the payment `pending` with the gateway status noted:
 * Paystack lets the payer retry on the same checkout, and a later success must still confirm.
 * Stale pending card payments are closed by the S9 `payment-checks` job.
 */

export type CardSettleOutcome =
  | ConfirmOutcome
  | { outcome: "declined"; gatewayStatus: string }
  | { outcome: "not_ready"; gatewayStatus: string }
  | { outcome: "verify_unavailable" };

/** Gateway statuses shown to the payer as "didn't go through" (the payment stays open). */
export const DECLINED_STATUSES = new Set(["failed", "abandoned", "reversed"]);

/** Notes the gateway's latest status on a still-pending payment, for the status screen. */
async function noteGatewayStatus(deps: Pick<CardDeps, "db">, payment: Payment, status: string): Promise<void> {
  if (payment.resultDesc === status) return;
  await deps.db
    .update(payments)
    .set({ resultDesc: status.slice(0, 40) })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
}

/** Who asked for the Verify: the payer returning, the webhook, the status poll or an S9 job. */
export type CardSettleSource = "return" | "webhook" | "poll" | "job";

export async function settleCardPayment(deps: CardDeps, paymentId: string, source: CardSettleSource): Promise<CardSettleOutcome> {
  const payment = await getPayment(deps.db, paymentId);
  if (!payment || payment.method !== "card" || !payment.providerReference) return { outcome: "not_found" };
  if (payment.status !== "pending") {
    return payment.status === "confirmed" ? { outcome: "already_confirmed" } : { outcome: "not_pending", status: payment.status };
  }

  const reference = payment.providerReference;
  const verified = await deps.gateway.verify(reference);
  await recordPaymentEvent(deps.db, {
    eventType: "card_verify",
    paymentId: payment.id,
    invoiceId: payment.invoiceId,
    payload:
      verified.kind === "result"
        ? {
            source,
            reference,
            status: verified.status,
            amountMinor: verified.amountMinor,
            currency: verified.currency,
            channel: verified.channel,
            paidAt: verified.paidAt,
            transactionId: verified.transactionId,
          }
        : { source, reference, error: verified.error },
  });

  let result: CardSettleOutcome;
  if (verified.kind === "error" || verified.reference !== reference) {
    result = { outcome: "verify_unavailable" };
  } else if (verified.status === "success") {
    // Anything but KES makes the amount unknown, which flags the payment.
    const paidAmount = verified.currency === "KES" ? verified.amountMinor / 100 : null;
    result = await deps.withTransaction((tx) =>
      confirmPayment(tx, payment.id, {
        receipt: null,
        paidAmount,
        confirmedAt: deps.now(),
        card: { brand: verified.brand, last4: verified.last4 },
      }),
    );
  } else {
    await noteGatewayStatus(deps, payment, verified.status);
    result = DECLINED_STATUSES.has(verified.status)
      ? { outcome: "declined", gatewayStatus: verified.status }
      : { outcome: "not_ready", gatewayStatus: verified.status };
  }

  console.info(
    `[card] verify reference=${reference} source=${source} outcome=${result.outcome}${"reason" in result ? `:${result.reason}` : ""}`,
  );
  await receiptAfterConfirm(deps, result);
  return result;
}

/**
 * A card attempt still pending a day later, after one more Verify that wasn't a success (prompt S9
 * decision 11): closed as `cancelled` when the payer abandoned the checkout, otherwise `failed`.
 * Locked and re-checked, so a success that lands first wins.
 */
export async function closeStaleCardPayment(
  deps: Pick<CardDeps, "withTransaction">,
  paymentId: string,
  gatewayStatus: string,
): Promise<Awaited<ReturnType<typeof closePayment>>> {
  const status = gatewayStatus === "abandoned" ? "cancelled" : "failed";
  const result = await deps.withTransaction((tx) => closePayment(tx, paymentId, status));
  console.info(`[card] stale payment=${paymentId} gateway=${gatewayStatus} outcome=${result.outcome}`);
  return result;
}
