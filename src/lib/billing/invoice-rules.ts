import { CARD_CANCEL_BLOCK_MINUTES, IN_FLIGHT_SECONDS } from "./constants";

/**
 * When a lister may cancel or remove an unpaid invoice (prompt billing-cancel-delete-invoices,
 * decisions 3 and 4). Pure: the caller loads the invoice's payments.
 */

export interface InvoicePaymentFact {
  method: "stk_push" | "c2b_paybill" | "manual" | "card";
  status: "pending" | "confirmed" | "failed" | "cancelled" | "flagged" | "refunded" | "credited";
  createdAt: Date;
}

/** Payment statuses that mean money reached us for the invoice. */
const MONEY_STATUSES: ReadonlySet<InvoicePaymentFact["status"]> = new Set(["confirmed", "flagged", "refunded", "credited"]);

/** A payment that may still complete: a recent STK push or a recent card checkout. */
export function paymentInProgress(payments: readonly InvoicePaymentFact[], now: Date): boolean {
  return payments.some((p) => {
    if (p.status !== "pending") return false;
    const age = now.getTime() - p.createdAt.getTime();
    if (p.method === "stk_push") return age < IN_FLIGHT_SECONDS * 1000;
    if (p.method === "card") return age < CARD_CANCEL_BLOCK_MINUTES * 60 * 1000;
    return false;
  });
}

export function invoiceHasMoney(payments: readonly InvoicePaymentFact[]): boolean {
  return payments.some((p) => MONEY_STATUSES.has(p.status));
}

/** Only void invoices that no money ever touched may leave the lister's list. */
export function canHideInvoice(status: string, payments: readonly InvoicePaymentFact[]): boolean {
  return status === "void" && !invoiceHasMoney(payments);
}
