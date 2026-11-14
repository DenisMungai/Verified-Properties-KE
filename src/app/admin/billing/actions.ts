"use server";

import { redirect } from "next/navigation";
import type { ZodType } from "zod";
import { type ActionState, fieldErrorsFrom, GENERIC_FAILURE, keepValues } from "@/lib/action-state";
import { invalidatePublicListings } from "@/lib/cache/public-listings";
import {
  activateFlaggedPayment,
  applyPaybillToInvoice,
  closeFlaggedPayment,
  convertFlaggedPaymentToCredit,
  grantGoodwillCredit,
  recordPaybillPayment,
  refundFlaggedPayment,
  refundPaybillEvent,
  ADMIN_REFUSAL_MESSAGES,
  type AdminResult,
} from "@/lib/billing/admin-actions";
import { getBillingDeps } from "@/lib/billing/app-deps";
import { errorName } from "@/lib/log";
import { ADMIN_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/session";
import {
  activateSchema,
  applyPaybillSchema,
  goodwillCreditSchema,
  idSchema,
  reasonOnlySchema,
  recordPaybillSchema,
  refundSchema,
} from "@/lib/validation/billing-admin";

/**
 * Billing admin actions (prompt S10). Billing and platform admins only: anyone else gets a 404
 * from `requireRole`. The actor comes from the session; every input is parsed with Zod and the
 * payment's real state is re-read inside the transaction. Success redirects with a notice.
 */

const BILLING = "/admin/billing";

const paymentPath = (id: string, notice?: string) => `${BILLING}/payments/${id}${notice ? `?notice=${notice}` : ""}`;
const paybillPath = (id: string, notice?: string) => `${BILLING}/paybill/${id}${notice ? `?notice=${notice}` : ""}`;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

type Parsed<T> = { ok: true; data: T } | { ok: false; state: ActionState };

function parse<T>(schema: ZodType<T>, formData: FormData, names: readonly string[]): Parsed<T> {
  const values = keepValues(formData, names);
  const result = schema.safeParse(values);
  return result.success ? { ok: true, data: result.data } : { ok: false, state: { fieldErrors: fieldErrorsFrom(result.error), values } };
}

/** Runs one billing action; a successful one can activate or end a plan (restoring or pausing listings, the badge), so the public cache is cleared. */
async function attempt(run: () => Promise<AdminResult>): Promise<AdminResult | "failed"> {
  try {
    const result = await run();
    if (result.ok) invalidatePublicListings();
    return result;
  } catch (error) {
    console.error("[billing-admin] action failed", errorName(error));
    return "failed";
  }
}

function refusal(result: AdminResult | "failed", values?: Record<string, string>): ActionState {
  if (result === "failed") return { formError: GENERIC_FAILURE, values };
  if (result.ok) return {};
  return { formError: ADMIN_REFUSAL_MESSAGES[result.code], values };
}

function idFrom(formData: FormData, name: string): string | null {
  const parsed = idSchema.safeParse(text(formData, name));
  return parsed.success ? parsed.data : null;
}

const NOT_FOUND: ActionState = { formError: ADMIN_REFUSAL_MESSAGES.not_found };

export async function activatePaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(ADMIN_ROLES, BILLING);
  const input = parse(activateSchema, formData, ["paymentId", "receipt", "amountKes", "reason"]);
  if (!input.ok) return input.state;
  const { paymentId, receipt, amountKes, reason } = input.data;
  const result = await attempt(() =>
    activateFlaggedPayment(getBillingDeps(), admin.id, {
      paymentId,
      receipt: receipt === "" ? null : receipt,
      amountKes: amountKes === "" ? null : amountKes,
      reason,
    }),
  );
  if (result !== "failed" && result.ok) redirect(paymentPath(paymentId, "activated"));
  return refusal(result, keepValues(formData, ["receipt", "amountKes", "reason"]));
}

export async function refundPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(ADMIN_ROLES, BILLING);
  const paymentId = idFrom(formData, "paymentId");
  if (!paymentId) return NOT_FOUND;
  const input = parse(refundSchema, formData, ["reference", "amountKes", "reason"]);
  if (!input.ok) return input.state;
  const result = await attempt(() => refundFlaggedPayment(getBillingDeps(), admin.id, { paymentId, ...input.data }));
  if (result !== "failed" && result.ok) redirect(paymentPath(paymentId, "refunded"));
  return refusal(result, keepValues(formData, ["reference", "amountKes", "reason"]));
}

export async function closePaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(ADMIN_ROLES, BILLING);
  const paymentId = idFrom(formData, "paymentId");
  if (!paymentId) return NOT_FOUND;
  const input = parse(reasonOnlySchema, formData, ["reason"]);
  if (!input.ok) return input.state;
  const result = await attempt(() => closeFlaggedPayment(getBillingDeps(), admin.id, { paymentId, ...input.data }));
  if (result !== "failed" && result.ok) redirect(paymentPath(paymentId, "closed"));
  return refusal(result, keepValues(formData, ["reason"]));
}

export async function creditFromPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(ADMIN_ROLES, BILLING);
  const paymentId = idFrom(formData, "paymentId");
  if (!paymentId) return NOT_FOUND;
  const input = parse(reasonOnlySchema, formData, ["reason"]);
  if (!input.ok) return input.state;
  const result = await attempt(() => convertFlaggedPaymentToCredit(getBillingDeps(), admin.id, { paymentId, ...input.data }));
  if (result !== "failed" && result.ok) redirect(paymentPath(paymentId, "credited"));
  return refusal(result, keepValues(formData, ["reason"]));
}

export async function goodwillCreditAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(ADMIN_ROLES, BILLING);
  const backTo = idFrom(formData, "paymentId");
  const input = parse(goodwillCreditSchema, formData, ["subscriptionId", "days", "reason"]);
  if (!input.ok) return input.state;
  const result = await attempt(() => grantGoodwillCredit(getBillingDeps(), admin.id, input.data));
  if (result !== "failed" && result.ok) redirect(backTo ? paymentPath(backTo, "credit_added") : `${BILLING}?notice=credit_added`);
  return refusal(result, keepValues(formData, ["days", "reason"]));
}

export async function applyPaybillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(ADMIN_ROLES, BILLING);
  const eventId = idFrom(formData, "eventId");
  if (!eventId) return NOT_FOUND;
  const input = parse(applyPaybillSchema, formData, ["invoiceNumber", "reason"]);
  if (!input.ok) return input.state;
  const result = await attempt(() => applyPaybillToInvoice(getBillingDeps(), admin.id, { eventId, ...input.data }));
  if (result !== "failed" && result.ok && result.paymentId) redirect(paymentPath(result.paymentId, "applied"));
  return refusal(result, keepValues(formData, ["invoiceNumber", "reason"]));
}

export async function refundPaybillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(ADMIN_ROLES, BILLING);
  const eventId = idFrom(formData, "eventId");
  if (!eventId) return NOT_FOUND;
  const input = parse(refundSchema, formData, ["reference", "amountKes", "reason"]);
  if (!input.ok) return input.state;
  const result = await attempt(() => refundPaybillEvent(getBillingDeps(), admin.id, { eventId, ...input.data }));
  if (result !== "failed" && result.ok) redirect(paybillPath(eventId, "refunded"));
  return refusal(result, keepValues(formData, ["reference", "amountKes", "reason"]));
}

export async function recordPaybillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(ADMIN_ROLES, BILLING);
  const names = ["invoiceNumber", "receipt", "amountKes", "phone", "reason"] as const;
  const input = parse(recordPaybillSchema, formData, names);
  if (!input.ok) return input.state;
  const { phone, ...rest } = input.data;
  const result = await attempt(() => recordPaybillPayment(getBillingDeps(), admin.id, { ...rest, phoneE164: phone }));
  if (result !== "failed" && result.ok && result.paymentId) redirect(paymentPath(result.paymentId, "recorded"));
  return refusal(result, keepValues(formData, names));
}
