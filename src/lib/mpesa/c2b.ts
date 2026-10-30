import "server-only";
import { findInvoiceByNumber, insertC2bPayment, recordPaymentEvent } from "@/db/queries/payments";
import { normalizeKenyanPhone } from "@/lib/kenya";
import { receiptAfterConfirm } from "@/lib/billing/receipts";
import { confirmPayment, type ConfirmOutcome } from "./confirm";
import type { PaymentDeps } from "./deps";
import { parseC2b, wholeKes, type C2bPayment } from "./payloads";

/**
 * Paybill fallback (prompt S5 decisions 8 and 9): the lister pays to the Paybill with their
 * invoice number as the account number. STK Query cannot check these, so a payment counts only
 * through the secret token, the IP allowlist and an exact invoice-and-amount match; S9's nightly
 * reconciliation is the second check.
 */

export type C2bValidationResponse = { ResultCode: "0" | "C2B00012" | "C2B00013"; ResultDesc: string };

const ACCEPT: C2bValidationResponse = { ResultCode: "0", ResultDesc: "Accepted" };
const INVALID_ACCOUNT: C2bValidationResponse = { ResultCode: "C2B00012", ResultDesc: "Rejected" };
const INVALID_AMOUNT: C2bValidationResponse = { ResultCode: "C2B00013", ResultDesc: "Rejected" };

/** Called by Safaricom before a Paybill payment completes (when external validation is on). */
export async function validateC2b(
  deps: Pick<PaymentDeps, "db">,
  { payload, sourceIp }: { payload: unknown; sourceIp: string | null },
): Promise<C2bValidationResponse> {
  const c2b = parseC2b(payload);
  const invoice = c2b ? await findInvoiceByNumber(deps.db, c2b.billRef) : null;
  let response: C2bValidationResponse;
  if (!c2b || !invoice || invoice.status !== "open") response = INVALID_ACCOUNT;
  else if (wholeKes(c2b.amount) !== invoice.amountKes) response = INVALID_AMOUNT;
  else response = ACCEPT;

  await recordPaymentEvent(deps.db, {
    eventType: "c2b_validation",
    invoiceId: invoice?.id,
    sourceIp,
    payload: { body: payload, response: response.ResultCode },
  });
  return response;
}

/** Records the confirmation as received; the caller answers Safaricom, then calls `confirmC2b`. */
export async function recordC2bConfirmation(
  deps: Pick<PaymentDeps, "db">,
  { payload, sourceIp }: { payload: unknown; sourceIp: string | null },
): Promise<C2bPayment | null> {
  const c2b = parseC2b(payload);
  const invoice = c2b ? await findInvoiceByNumber(deps.db, c2b.billRef) : null;
  await recordPaymentEvent(deps.db, { eventType: "c2b_confirmation", invoiceId: invoice?.id, sourceIp, payload });
  if (!c2b) console.warn("[mpesa] c2b confirmation rejected: unrecognised body");
  return c2b;
}

export type C2bOutcome = ConfirmOutcome | { outcome: "unmatched" } | { outcome: "duplicate" };

export async function confirmC2b(deps: PaymentDeps, c2b: C2bPayment, raw: unknown): Promise<C2bOutcome> {
  const result = await deps.withTransaction(async (tx): Promise<C2bOutcome> => {
    const invoice = await findInvoiceByNumber(tx, c2b.billRef);
    if (!invoice) return { outcome: "unmatched" };
    const payment = await insertC2bPayment(tx, {
      invoiceId: invoice.id,
      phoneE164: c2b.msisdn ? (normalizeKenyanPhone(c2b.msisdn)?.e164 ?? null) : null,
      mpesaReceipt: c2b.transId,
      amountKes: invoice.amountKes,
      paidAmountKes: wholeKes(c2b.amount),
      rawCallback: raw,
    });
    if (!payment) return { outcome: "duplicate" };
    return confirmPayment(tx, payment.id, { receipt: c2b.transId, paidAmount: c2b.amount, confirmedAt: deps.now() });
  });

  if (result.outcome === "unmatched") {
    // The account number is not an invoice: kept as an event for an admin to match (S10).
    console.warn(`[mpesa] unmatched paybill payment trans=${c2b.transId}`);
  } else {
    console.info(
      `[mpesa] paybill trans=${c2b.transId} invoice=${c2b.billRef} outcome=${result.outcome}${"reason" in result ? `:${result.reason}` : ""}`,
    );
  }
  await receiptAfterConfirm(deps, result);
  return result;
}
