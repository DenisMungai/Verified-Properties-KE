import { z } from "zod";
import { normalizeKenyanPhone } from "@/lib/kenya";
import { fullName } from "./auth";

/**
 * Buyer engagement and moderation input (prompt S8 decisions 2–5). Only the keys named here are
 * read, so a forged recipient, owner or status never reaches the output. Text is stored as plain
 * text and rendered by React, never as HTML.
 */

export const INQUIRY_MESSAGE_MIN = 10;
export const INQUIRY_MESSAGE_MAX = 2000;
export const REPORT_DETAILS_MAX = 2000;
export const DECISION_REASON_MIN = 10;
export const DECISION_REASON_MAX = 500;

export const DEFAULT_INQUIRY_MESSAGE = "Hi, I'd like to arrange a viewing of this property. When is it available?";

export const PHONE_ERROR = "Enter a Kenyan number, e.g. 0712 345 678.";

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (value === "" ? null : value))
  .pipe(
    z
      .email({ error: "Enter a valid email address, for example name@example.com." })
      .max(254, { error: "Email address is too long." })
      .nullable(),
  );

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

export const inquirySchema = z
  .object({
    fullName,
    phone: optionalPhone,
    email: optionalEmail,
    message: z
      .string()
      .trim()
      .min(INQUIRY_MESSAGE_MIN, { error: `Write at least ${INQUIRY_MESSAGE_MIN} characters.` })
      .max(INQUIRY_MESSAGE_MAX, { error: `Use at most ${INQUIRY_MESSAGE_MAX} characters.` }),
  })
  .superRefine((value, ctx) => {
    if (value.phone === null && value.email === null) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Add a phone number or an email so the lister can reply." });
    }
  });

export type InquiryInput = z.output<typeof inquirySchema>;

export const INQUIRY_FIELDS = ["fullName", "phone", "email", "message"] as const;

export const REPORT_REASONS = [
  "scam",
  "wrong_details",
  "unavailable",
  "duplicate",
  "offensive",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  scam: "Scam or fraud",
  wrong_details: "Wrong price or details",
  unavailable: "Already sold or rented",
  duplicate: "Duplicate listing",
  offensive: "Offensive content",
  other: "Other",
};

export const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS, { error: "Choose a reason." }),
  details: z
    .string()
    .trim()
    .max(REPORT_DETAILS_MAX, { error: `Use at most ${REPORT_DETAILS_MAX} characters.` })
    .transform((value) => (value === "" ? null : value)),
});

export type ReportInput = z.output<typeof reportSchema>;

/** Reject and take-down reasons, shown to the lister. */
export const decisionReasonSchema = z
  .string()
  .trim()
  .min(DECISION_REASON_MIN, { error: `Write at least ${DECISION_REASON_MIN} characters so the lister knows what to fix.` })
  .max(DECISION_REASON_MAX, { error: `Use at most ${DECISION_REASON_MAX} characters.` });
