import { z } from "zod";

/**
 * Daraja request and callback bodies (prompt S5). Pure parsers: numbers that arrive as strings are
 * accepted, unknown fields are ignored, and nothing here trusts a value beyond its shape.
 */

/** Integers Daraja sends either as numbers or numeric strings ("0", 1032). */
const intLike = z.union([z.number(), z.string().regex(/^-?\d+$/)]).transform((v) => Number(v));

/** Amounts: 1, 1.0, "10", "10.00". Kept as a number so a fraction can be flagged later. */
const amountLike = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).transform((v) => Number(v));

/** M-Pesa receipt / transaction ids, e.g. "NLJ7RT61SV". */
export const RECEIPT_PATTERN = /^[A-Z0-9]{8,20}$/;

/* -------------------------------------------------------------------------- */
/* STK Push callback                                                          */
/* -------------------------------------------------------------------------- */

const metadataItem = z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() });

const stkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string(),
      CheckoutRequestID: z.string().min(1).max(100),
      ResultCode: intLike,
      ResultDesc: z.string().default(""),
      CallbackMetadata: z.object({ Item: z.array(metadataItem) }).optional(),
    }),
  }),
});

export interface StkCallback {
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: number;
  resultDesc: string;
  /** Present on success only. */
  receipt: string | null;
  amount: number | null;
  /** Payer, 2547XXXXXXXX as Daraja sends it. */
  phone: string | null;
}

function item(items: z.infer<typeof metadataItem>[], name: string): string | number | undefined {
  return items.find((i) => i.Name === name)?.Value;
}

export function parseStkCallback(body: unknown): StkCallback | null {
  const parsed = stkCallbackSchema.safeParse(body);
  if (!parsed.success) return null;
  const cb = parsed.data.Body.stkCallback;
  const items = cb.CallbackMetadata?.Item ?? [];

  const receiptValue = item(items, "MpesaReceiptNumber");
  const receipt = typeof receiptValue === "string" && RECEIPT_PATTERN.test(receiptValue) ? receiptValue : null;
  const amountParsed = amountLike.safeParse(item(items, "Amount"));
  const phoneValue = item(items, "PhoneNumber");

  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: cb.MerchantRequestID,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc.slice(0, 300),
    receipt,
    amount: amountParsed.success ? amountParsed.data : null,
    phone: phoneValue === undefined ? null : String(phoneValue),
  };
}

/* -------------------------------------------------------------------------- */
/* STK Push request, STK Query and OAuth responses                            */
/* -------------------------------------------------------------------------- */

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: intLike,
});

export const stkPushResponseSchema = z.object({
  MerchantRequestID: z.string(),
  CheckoutRequestID: z.string().min(1),
  ResponseCode: z.union([z.string(), z.number()]).transform(String),
  ResponseDescription: z.string().default(""),
  CustomerMessage: z.string().default(""),
});

export const stkQueryResultSchema = z.object({
  ResultCode: intLike,
  ResultDesc: z.string().default(""),
});

/** Daraja's error envelope, e.g. { errorCode: "500.001.1001", errorMessage: "...being processed" }. */
export const darajaErrorSchema = z.object({
  errorCode: z.string(),
  errorMessage: z.string().default(""),
});

/* -------------------------------------------------------------------------- */
/* C2B (Paybill) validation and confirmation                                  */
/* -------------------------------------------------------------------------- */

const c2bSchema = z.object({
  TransID: z.string().regex(RECEIPT_PATTERN),
  TransAmount: amountLike,
  BusinessShortCode: z.union([z.string(), z.number()]).transform(String),
  BillRefNumber: z.string().default(""),
  MSISDN: z.union([z.string(), z.number()]).transform(String).optional(),
});

export interface C2bPayment {
  transId: string;
  amount: number;
  shortcode: string;
  /** Trimmed and upper-cased so "vpk0000012 " matches VPK0000012. */
  billRef: string;
  /** Raw MSISDN; newer APIs mask it, so it may not be a usable number. */
  msisdn: string | null;
}

export function parseC2b(body: unknown): C2bPayment | null {
  const parsed = c2bSchema.safeParse(body);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    transId: d.TransID,
    amount: d.TransAmount,
    shortcode: d.BusinessShortCode,
    billRef: d.BillRefNumber.trim().toUpperCase(),
    msisdn: d.MSISDN ?? null,
  };
}

/** Whole, non-negative shillings, or null for fractions and nonsense. */
export function wholeKes(amount: number | null): number | null {
  return amount !== null && Number.isInteger(amount) && amount >= 0 ? amount : null;
}
