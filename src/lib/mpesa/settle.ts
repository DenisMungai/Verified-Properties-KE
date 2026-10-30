import "server-only";
import {
  findPaymentByCheckoutId,
  getPayment,
  recordPaymentEvent,
  storeStkCallback,
} from "@/db/queries/payments";
import { receiptAfterConfirm } from "@/lib/billing/receipts";
import type { StkQueryResult } from "./client";
import { closePayment, confirmPayment, flagPendingPayment, type ConfirmOutcome } from "./confirm";
import type { PaymentDeps } from "./deps";
import { parseStkCallback, wholeKes } from "./payloads";
import { decideStkOutcome, RESULT_SUCCESS } from "./result-codes";

/**
 * STK callbacks (prompt S5 decision 6). The route records the raw callback first, answers
 * Safaricom, then settles the payment after the response: STK Query must agree with the callback
 * before anything changes. `settleStkPayment` is safe to run again (S6 polling, S9 jobs).
 */

/** Delays before each STK Query attempt while Daraja is still processing. */
export const QUERY_DELAYS_MS = [0, 2_000, 5_000] as const;

export type RecordedCallback = { paymentId: string | null; valid: boolean };

/** Records every callback as an event; stores the first one on its pending payment. */
export async function recordStkCallback(
  deps: Pick<PaymentDeps, "db">,
  { payload, sourceIp }: { payload: unknown; sourceIp: string | null },
): Promise<RecordedCallback> {
  const callback = parseStkCallback(payload);
  const payment = callback ? await findPaymentByCheckoutId(deps.db, callback.checkoutRequestId) : null;

  await recordPaymentEvent(deps.db, {
    eventType: "stk_callback",
    paymentId: payment?.id,
    invoiceId: payment?.invoiceId,
    sourceIp,
    payload,
  });
  if (!callback) {
    console.warn("[mpesa] stk callback rejected: unrecognised body");
    return { paymentId: null, valid: false };
  }
  if (!payment) {
    console.warn(`[mpesa] stk callback for unknown checkout=${callback.checkoutRequestId}`);
    return { paymentId: null, valid: true };
  }

  const stored = await storeStkCallback(deps.db, payment.id, {
    raw: payload,
    resultCode: callback.resultCode,
    resultDesc: callback.resultDesc,
    receipt: callback.resultCode === RESULT_SUCCESS ? callback.receipt : null,
    paidAmountKes: wholeKes(callback.amount),
  });
  console.info(
    `[mpesa] stk callback checkout=${callback.checkoutRequestId} result=${callback.resultCode}${stored ? "" : " (repeat, kept as event)"}`,
  );
  return { paymentId: payment.id, valid: true };
}

async function queryUntilDefinitive(deps: PaymentDeps, paymentId: string, invoiceId: string, checkoutRequestId: string) {
  let last: StkQueryResult = { kind: "pending" };
  for (const delay of QUERY_DELAYS_MS) {
    if (delay > 0) await deps.sleep(delay);
    last = await deps.daraja.stkQuery(checkoutRequestId);
    await recordPaymentEvent(deps.db, { eventType: "stk_query", paymentId, invoiceId, payload: { checkoutRequestId, ...last } });
    if (last.kind === "result") return last;
  }
  return last;
}

export type SettleOutcome =
  | ConfirmOutcome
  | { outcome: "closed"; status: "cancelled" | "failed" }
  | { outcome: "not_ready" }
  | { outcome: "query_unavailable" };

export async function settleStkPayment(deps: PaymentDeps, paymentId: string): Promise<SettleOutcome> {
  const payment = await getPayment(deps.db, paymentId);
  if (!payment) return { outcome: "not_found" };
  if (payment.status !== "pending") {
    return payment.status === "confirmed" ? { outcome: "already_confirmed" } : { outcome: "not_pending", status: payment.status };
  }
  const callback = payment.method === "stk_push" ? parseStkCallback(payment.rawCallback) : null;
  if (!callback || !payment.checkoutRequestId) return { outcome: "not_ready" };

  const query = await queryUntilDefinitive(deps, payment.id, payment.invoiceId, payment.checkoutRequestId);
  const log = (outcome: string) =>
    console.info(`[mpesa] settle checkout=${payment.checkoutRequestId} query=${query.kind === "result" ? query.resultCode : query.kind} outcome=${outcome}`);
  if (query.kind !== "result") {
    log("query_unavailable");
    return { outcome: "query_unavailable" };
  }

  const decision = decideStkOutcome(callback.resultCode, query.resultCode);
  let result: SettleOutcome;
  switch (decision.action) {
    case "confirm": {
      const receipt = callback.receipt;
      result = receipt
        ? await deps.withTransaction((tx) =>
            confirmPayment(tx, payment.id, { receipt, paidAmount: callback.amount, confirmedAt: deps.now() }),
          )
        : await deps.withTransaction((tx) => flagPendingPayment(tx, payment.id, "missing_receipt"));
      break;
    }
    case "close":
      result = await deps.withTransaction((tx) => closePayment(tx, payment.id, decision.status));
      break;
    case "flag":
      result = await deps.withTransaction((tx) => flagPendingPayment(tx, payment.id, decision.reason));
      break;
  }
  log("reason" in result ? `${result.outcome}:${result.reason}` : result.outcome);
  await receiptAfterConfirm(deps, result);
  return result;
}
