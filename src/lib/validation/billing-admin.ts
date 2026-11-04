import { z } from "zod";
import { MAX_GOODWILL_CREDIT_DAYS } from "@/lib/billing/credit";
import { normalizeKenyanPhone } from "@/lib/kenya";
import { PHONE_ERROR } from "./engagement";

/**
 * Billing admin input (prompt S10). Only the keys named here are read. Amounts for Paybill money
 * that arrived by callback, credit days for converted payments, plans and subscriptions are never
 * taken from the form.
 */

export const BILLING_REASON_MIN = 10;
export const BILLING_REASON_MAX = 500;
export const SEARCH_MAX = 40;
/** Generous upper bound for one plan payment, in whole KES. */
const MAX_AMOUNT_KES = 1_000_000;

export const INVOICE_NUMBER = /^VPK\d{7,9}$/;
/** M-Pesa receipts (TransID): 10 upper-case letters and digits, at least one letter. */
export const MPESA_RECEIPT = /^(?=.*[A-Z])[A-Z0-9]{10}$/;

export const billingReasonSchema = z
  .string()
  .trim()
  .min(BILLING_REASON_MIN, { error: `Write at least ${BILLING_REASON_MIN} characters so the next admin understands why.` })
  .max(BILLING_REASON_MAX, { error: `Use at most ${BILLING_REASON_MAX} characters.` });

export const idSchema = z.uuid({ error: "We couldn't find that item." });

export const receiptSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(MPESA_RECEIPT, { error: "Enter the 10-character M-Pesa receipt, e.g. SGR7ABC123." });

export const invoiceNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(INVOICE_NUMBER, { error: "Enter an invoice number like VPK0000123." });

export const amountKesSchema = z.coerce
  .number({ error: "Enter the amount in whole shillings." })
  .int({ error: "Enter the amount in whole shillings." })
  .min(1, { error: "Enter the amount in whole shillings." })
  .max(MAX_AMOUNT_KES, { error: "That amount is too large for one plan payment." });

/** M-Pesa reversal or B2C receipt, or the Paystack refund id. */
export const refundReferenceSchema = z
  .string()
  .trim()
  .min(4, { error: "Enter the refund reference from M-Pesa or Paystack." })
  .max(100, { error: "Use at most 100 characters." })
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, { error: "Use letters, digits, spaces, dots, dashes or slashes." });

const optionalPhone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const normalized = normalizeKenyanPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: PHONE_ERROR });
      return z.NEVER;
    }
    return normalized.e164;
  });

/** Money proven on the statement (Activate on a flagged payment). Blank fields use the stored callback. */
export const activateSchema = z.object({
  paymentId: idSchema,
  receipt: z.union([z.literal(""), receiptSchema]),
  amountKes: z.union([z.literal(""), amountKesSchema]),
  reason: billingReasonSchema,
});

export const refundSchema = z.object({
  reference: refundReferenceSchema,
  amountKes: amountKesSchema,
  reason: billingReasonSchema,
});

export const reasonOnlySchema = z.object({ reason: billingReasonSchema });

export const goodwillCreditSchema = z.object({
  subscriptionId: idSchema,
  days: z.coerce
    .number({ error: `Enter 1 to ${MAX_GOODWILL_CREDIT_DAYS} days.` })
    .int({ error: `Enter 1 to ${MAX_GOODWILL_CREDIT_DAYS} days.` })
    .min(1, { error: `Enter 1 to ${MAX_GOODWILL_CREDIT_DAYS} days.` })
    .max(MAX_GOODWILL_CREDIT_DAYS, { error: `Enter 1 to ${MAX_GOODWILL_CREDIT_DAYS} days.` }),
  reason: billingReasonSchema,
});

/** A Paybill payment seen on the M-Pesa statement with no callback (decision 9). */
export const recordPaybillSchema = z.object({
  invoiceNumber: invoiceNumberSchema,
  receipt: receiptSchema,
  amountKes: amountKesSchema,
  phone: optionalPhone,
  reason: billingReasonSchema,
});

/** Unmatched Paybill money: receipt, amount and phone come from the stored event (decision 8). */
export const applyPaybillSchema = z.object({
  invoiceNumber: invoiceNumberSchema,
  reason: billingReasonSchema,
});

export type BillingSearch =
  | { kind: "invoice"; invoiceNumber: string }
  | { kind: "phone"; e164: string }
  | { kind: "receipt"; receipt: string }
  | { kind: "reference"; reference: string };

/**
 * Decides what the admin typed (decision 3). Phones are tried before receipts because
 * "0712345678" is also ten characters; receipts always contain a letter.
 */
export function classifyBillingSearch(raw: string | undefined): BillingSearch | null {
  const q = (raw ?? "").trim().slice(0, SEARCH_MAX);
  if (q === "") return null;
  const upper = q.toUpperCase().replace(/\s+/g, "");
  if (INVOICE_NUMBER.test(upper)) return { kind: "invoice", invoiceNumber: upper };
  const phone = normalizeKenyanPhone(q);
  if (phone) return { kind: "phone", e164: phone.e164 };
  if (MPESA_RECEIPT.test(upper)) return { kind: "receipt", receipt: upper };
  return { kind: "reference", reference: q };
}
