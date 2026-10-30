import { formatNairobiDate } from "@/lib/format";

/**
 * What the "Check your phone" / card status screen may know about a payment (prompt S6 decision
 * 6): state, invoice, plan, amount and paid-until date. Never receipts, phones, gateway
 * descriptions or raw callbacks. Client-safe.
 */

export type PaymentState = "waiting" | "confirmed" | "failed" | "cancelled" | "flagged";

export interface PaymentView {
  state: PaymentState;
  method: "mpesa" | "card";
  invoiceNumber: string;
  planName: string;
  amountKes: number;
  /** "1 Dec 2026", once confirmed. */
  paidUntil: string | null;
}

export function paymentView(row: {
  method: "stk_push" | "c2b_paybill" | "manual" | "card";
  status: "pending" | "confirmed" | "failed" | "cancelled" | "flagged";
  resultDesc: string | null;
  invoiceNumber: string;
  planName: string;
  amountKes: number;
  periodEnd: Date | null;
}): PaymentView {
  const method = row.method === "card" ? "card" : "mpesa";
  let state: PaymentState;
  if (row.status === "pending") {
    // A declined card stays pending (the payer may retry on Paystack's page) but reads as failed.
    if (method === "card" && row.resultDesc === "abandoned") state = "cancelled";
    else if (method === "card" && (row.resultDesc === "failed" || row.resultDesc === "reversed")) state = "failed";
    else state = "waiting";
  } else {
    state = row.status === "confirmed" ? "confirmed" : row.status;
  }
  return {
    state,
    method,
    invoiceNumber: row.invoiceNumber,
    planName: row.planName,
    amountKes: row.amountKes,
    paidUntil: state === "confirmed" && row.periodEnd ? formatNairobiDate(row.periodEnd) : null,
  };
}
