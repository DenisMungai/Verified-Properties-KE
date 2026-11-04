import "server-only";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { getPaybillEvent, insertBillingAudit, type AuditAction } from "@/db/queries/billing-admin";
import {
  findInvoiceByNumber,
  getPlan,
  insertManualPayment,
  lockInvoice,
  lockPayment,
  lockSubscription,
  paymentWithReceipt,
  recordPaymentEvent,
  updatePayment,
  updateSubscription,
  type Payment,
  type Subscription,
} from "@/db/queries/payments";
import { normalizeKenyanPhone } from "@/lib/kenya";
import { confirmPayment, type ConfirmOutcome, type FlagReason } from "@/lib/mpesa/confirm";
import { canReceiveCredit, creditDaysFromPayment, extendPeriodByDays } from "./credit";
import type { BillingDeps } from "./deps";
import { receiptAfterConfirm } from "./receipts";

/**
 * Billing admin actions (prompt S10 decisions 5–10, 13). Each runs in one transaction: rows are
 * locked payment → invoice → subscription (the `confirmPayment` order), state is re-checked after
 * locking, and the audit row commits with the change. A refusal found after a write throws
 * `Refused`, which rolls the transaction back and becomes a typed result.
 */

export type AdminRefusal =
  | "not_found"
  | "already_resolved"
  | "not_allowed"
  | "invoice_not_found"
  | "invoice_not_open"
  | "amount_mismatch"
  | "callback_mismatch"
  | "receipt_required"
  | "amount_required"
  | "receipt_in_use"
  | "refund_too_large"
  | "paid_amount_unknown"
  | "plan_lapsed"
  | "credit_too_small";

export type AdminResult =
  | { ok: true; paymentId?: string; creditDays?: number; restoredListings?: number }
  | { ok: false; code: AdminRefusal; otherPaymentId?: string };

export const ADMIN_REFUSAL_MESSAGES: Record<AdminRefusal, string> = {
  not_found: "We couldn't find that item.",
  already_resolved: "Someone already resolved this. Reload to see the latest.",
  not_allowed: "That action doesn't apply to this payment.",
  invoice_not_found: "There's no invoice with that number.",
  invoice_not_open: "That invoice isn't open, so it can't take this money. Refund it or turn it into a credit instead.",
  amount_mismatch: "The amount doesn't match the invoice. Refund it, or turn it into a credit if the plan is paid.",
  callback_mismatch: "That doesn't match what M-Pesa sent in the callback. Check the statement again.",
  receipt_required: "Enter the M-Pesa receipt from the statement.",
  amount_required: "Enter the amount shown on the statement.",
  receipt_in_use: "That receipt is already recorded on another payment.",
  refund_too_large: "The refund can't be more than was paid.",
  paid_amount_unknown: "We don't know how much was paid, so this can't become a credit. Record a refund instead.",
  plan_lapsed: "Credits only extend a paid period. Refund instead, or ask the lister to renew.",
  credit_too_small: "That amount is worth less than one day of the plan. Record a refund instead.",
};

/** Flags where the money may well have arrived for an open invoice: activate once verified. */
const ACTIVATABLE_FLAGS: readonly FlagReason[] = ["missing_receipt", "callback_query_mismatch"];
/** Flags where real money bought nothing: it can become plan days instead of a refund. */
const CREDITABLE_FLAGS: readonly FlagReason[] = ["invoice_not_open", "amount_mismatch"];

export type AdminDeps = Pick<BillingDeps, "db" | "withTransaction" | "now" | "email" | "appUrl">;

class Refused extends Error {
  constructor(
    readonly code: AdminRefusal,
    readonly otherPaymentId?: string,
  ) {
    super(code);
  }
}

async function run(deps: AdminDeps, name: AuditAction, fn: (tx: DbExecutor) => Promise<AdminResult>): Promise<AdminResult> {
  let result: AdminResult;
  try {
    result = await deps.withTransaction(fn);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    result = { ok: false, code: error.code, ...(error.otherPaymentId ? { otherPaymentId: error.otherPaymentId } : {}) };
  }
  console.info(`[billing-admin] action=${name} outcome=${result.ok ? "ok" : result.code}`);
  return result;
}

async function statusChange(tx: DbExecutor, payment: Pick<Payment, "id" | "invoiceId">, payload: Record<string, unknown>) {
  await recordPaymentEvent(tx, { eventType: "status_change", paymentId: payment.id, invoiceId: payment.invoiceId, payload: { ...payload, by: "admin" } });
}

async function lockFlagged(tx: DbExecutor, paymentId: string): Promise<Payment> {
  const payment = await lockPayment(tx, paymentId);
  if (!payment) throw new Refused("not_found");
  if (payment.status !== "flagged") throw new Refused("already_resolved");
  return payment;
}

function confirmedOrThrow(outcome: ConfirmOutcome): Extract<ConfirmOutcome, { outcome: "confirmed" }> {
  if (outcome.outcome === "confirmed") return outcome;
  if (outcome.outcome === "flagged") {
    throw new Refused(outcome.reason === "amount_mismatch" ? "amount_mismatch" : outcome.reason === "duplicate_receipt" ? "receipt_in_use" : "invoice_not_open");
  }
  throw new Refused("already_resolved");
}

async function sendReceipt(deps: AdminDeps, result: AdminResult): Promise<void> {
  if (result.ok && result.paymentId) await receiptAfterConfirm(deps, { outcome: "confirmed", paymentId: result.paymentId });
}

/* -------------------------------------------------------------------------- */
/* Flagged payments                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Activate (decision 5): the admin found the money on the M-Pesa statement. The stored callback
 * wins over typed values; typed values must agree with it. Then the ordinary `confirmPayment`.
 */
export async function activateFlaggedPayment(
  deps: AdminDeps,
  actorUserId: string,
  input: { paymentId: string; receipt: string | null; amountKes: number | null; reason: string },
): Promise<AdminResult> {
  const now = deps.now();
  const result = await run(deps, "activate_payment", async (tx) => {
    const payment = await lockFlagged(tx, input.paymentId);
    if (payment.method === "card" || !ACTIVATABLE_FLAGS.includes(payment.flagReason as FlagReason)) throw new Refused("not_allowed");

    if (payment.mpesaReceipt && input.receipt && input.receipt !== payment.mpesaReceipt) throw new Refused("callback_mismatch");
    if (payment.paidAmountKes !== null && input.amountKes !== null && input.amountKes !== payment.paidAmountKes) throw new Refused("callback_mismatch");
    const receipt = payment.mpesaReceipt ?? input.receipt;
    const paid = payment.paidAmountKes ?? input.amountKes;
    if (!receipt) throw new Refused("receipt_required");
    if (paid === null) throw new Refused("amount_required");

    const other = await paymentWithReceipt(tx, receipt, payment.id);
    if (other) throw new Refused("receipt_in_use", other.id);
    const invoice = await lockInvoice(tx, payment.invoiceId);
    if (!invoice || invoice.status !== "open") throw new Refused("invoice_not_open");
    if (paid !== invoice.amountKes) throw new Refused("amount_mismatch");

    await updatePayment(tx, payment.id, { status: "pending", mpesaReceipt: receipt, paidAmountKes: paid });
    await statusChange(tx, payment, { entity: "payment", from: "flagged", to: "pending", action: "activate_payment" });
    const confirmed = confirmedOrThrow(await confirmPayment(tx, payment.id, { receipt, paidAmount: paid, confirmedAt: now }));

    await insertBillingAudit(tx, {
      actorUserId,
      action: "activate_payment",
      reason: input.reason,
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id,
      paymentId: payment.id,
      amountKes: paid,
      reference: receipt,
    });
    return { ok: true, paymentId: payment.id, restoredListings: confirmed.restoredListingIds.length };
  });
  await sendReceipt(deps, result);
  return result;
}

/** Record refund (decisions 5 and 6): the money went back outside the app. */
export async function refundFlaggedPayment(
  deps: AdminDeps,
  actorUserId: string,
  input: { paymentId: string; reference: string; amountKes: number; reason: string },
): Promise<AdminResult> {
  return run(deps, "refund_payment", async (tx) => {
    const payment = await lockFlagged(tx, input.paymentId);
    if (payment.paidAmountKes !== null && input.amountKes > payment.paidAmountKes) throw new Refused("refund_too_large");
    const invoice = await lockInvoice(tx, payment.invoiceId);
    await updatePayment(tx, payment.id, { status: "refunded" });
    await statusChange(tx, payment, { entity: "payment", from: "flagged", to: "refunded", action: "refund_payment", refundReference: input.reference, amountKes: input.amountKes });
    await insertBillingAudit(tx, {
      actorUserId,
      action: "refund_payment",
      reason: input.reason,
      subscriptionId: invoice?.subscriptionId ?? null,
      invoiceId: payment.invoiceId,
      paymentId: payment.id,
      amountKes: input.amountKes,
      reference: input.reference,
    });
    return { ok: true, paymentId: payment.id };
  });
}

/** Close, no money kept (decision 5): a duplicate record, or verified that nothing arrived. */
export async function closeFlaggedPayment(
  deps: AdminDeps,
  actorUserId: string,
  input: { paymentId: string; reason: string },
): Promise<AdminResult> {
  return run(deps, "close_payment", async (tx) => {
    const payment = await lockFlagged(tx, input.paymentId);
    const invoice = await lockInvoice(tx, payment.invoiceId);
    await updatePayment(tx, payment.id, { status: "failed" });
    await statusChange(tx, payment, { entity: "payment", from: "flagged", to: "failed", action: "close_payment" });
    await insertBillingAudit(tx, {
      actorUserId,
      action: "close_payment",
      reason: input.reason,
      subscriptionId: invoice?.subscriptionId ?? null,
      invoiceId: payment.invoiceId,
      paymentId: payment.id,
    });
    return { ok: true, paymentId: payment.id };
  });
}

/** The plan in force at `now`: a scheduled change applies from its date (S6 decision 3). */
async function planInForce(tx: DbExecutor, sub: Subscription, now: Date) {
  const scheduled = sub.scheduledPlanId && sub.scheduledChangeAt && sub.scheduledChangeAt.getTime() <= now.getTime();
  return getPlan(tx, scheduled ? sub.scheduledPlanId! : sub.planId);
}

async function creditSubscription(tx: DbExecutor, sub: Subscription, days: number, now: Date) {
  const credited = extendPeriodByDays({ status: sub.status, currentPeriodEnd: sub.currentPeriodEnd!, scheduledChangeAt: sub.scheduledChangeAt }, days, now);
  await updateSubscription(tx, sub.id, credited);
  return credited;
}

/** Convert to credit (decisions 5 and 7): money that bought nothing becomes days on the paid plan. */
export async function convertFlaggedPaymentToCredit(
  deps: AdminDeps,
  actorUserId: string,
  input: { paymentId: string; reason: string },
): Promise<AdminResult> {
  const now = deps.now();
  return run(deps, "credit_from_payment", async (tx) => {
    const payment = await lockFlagged(tx, input.paymentId);
    if (!CREDITABLE_FLAGS.includes(payment.flagReason as FlagReason)) throw new Refused("not_allowed");
    const paid = payment.paidAmountKes;
    if (paid === null || paid <= 0) throw new Refused("paid_amount_unknown");
    const invoice = await lockInvoice(tx, payment.invoiceId);
    const sub = invoice ? await lockSubscription(tx, invoice.subscriptionId) : null;
    if (!invoice || !sub) throw new Refused("not_found");
    if (!canReceiveCredit(sub, now)) throw new Refused("plan_lapsed");
    const plan = await planInForce(tx, sub, now);
    const days = plan ? creditDaysFromPayment(paid, plan.priceKes) : 0;
    if (days === 0) throw new Refused("credit_too_small");

    const credited = await creditSubscription(tx, sub, days, now);
    await updatePayment(tx, payment.id, { status: "credited" });
    await statusChange(tx, payment, { entity: "payment", from: "flagged", to: "credited", action: "credit_from_payment" });
    await statusChange(tx, payment, {
      entity: "subscription",
      subscriptionId: sub.id,
      from: sub.status,
      to: credited.status,
      action: "credit_from_payment",
      creditDays: days,
      periodEnd: credited.currentPeriodEnd.toISOString(),
    });
    await insertBillingAudit(tx, {
      actorUserId,
      action: "credit_from_payment",
      reason: input.reason,
      subscriptionId: sub.id,
      invoiceId: invoice.id,
      paymentId: payment.id,
      amountKes: paid,
      creditDays: days,
    });
    return { ok: true, paymentId: payment.id, creditDays: days };
  });
}

/* -------------------------------------------------------------------------- */
/* Goodwill credit                                                            */
/* -------------------------------------------------------------------------- */

export async function grantGoodwillCredit(
  deps: AdminDeps,
  actorUserId: string,
  input: { subscriptionId: string; days: number; reason: string },
): Promise<AdminResult> {
  const now = deps.now();
  return run(deps, "credit_days", async (tx) => {
    const sub = await lockSubscription(tx, input.subscriptionId);
    if (!sub) throw new Refused("not_found");
    if (!canReceiveCredit(sub, now)) throw new Refused("plan_lapsed");
    await creditSubscription(tx, sub, input.days, now);
    await insertBillingAudit(tx, {
      actorUserId,
      action: "credit_days",
      reason: input.reason,
      subscriptionId: sub.id,
      creditDays: input.days,
    });
    return { ok: true, creditDays: input.days };
  });
}

/* -------------------------------------------------------------------------- */
/* Paybill money                                                              */
/* -------------------------------------------------------------------------- */

/** `paymentWithReceipt` excludes one payment; a new one has no id yet. */
const NO_PAYMENT_ID = "00000000-0000-0000-0000-000000000000";

/** Serialises admins working on the same Paybill event (events can't be row-locked for update). */
async function lockPaybillEvent(tx: DbExecutor, eventId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paybill:${eventId}`}, 0))`);
}

async function applyMoneyToInvoice(
  tx: DbExecutor,
  now: Date,
  money: { invoiceNumber: string; receipt: string; amountKes: number; phoneE164: string | null; rawCallback: unknown },
): Promise<{ paymentId: string; invoiceId: string; subscriptionId: string; restored: number }> {
  const found = await findInvoiceByNumber(tx, money.invoiceNumber);
  if (!found) throw new Refused("invoice_not_found");
  const invoice = await lockInvoice(tx, found.id);
  if (!invoice || invoice.status !== "open") throw new Refused("invoice_not_open");
  if (money.amountKes !== invoice.amountKes) throw new Refused("amount_mismatch");
  const other = await paymentWithReceipt(tx, money.receipt, NO_PAYMENT_ID);
  if (other) throw new Refused("receipt_in_use", other.id);

  const payment = await insertManualPayment(tx, {
    invoiceId: invoice.id,
    phoneE164: money.phoneE164,
    mpesaReceipt: money.receipt,
    amountKes: invoice.amountKes,
    paidAmountKes: money.amountKes,
    rawCallback: money.rawCallback,
  });
  if (!payment) throw new Refused("receipt_in_use");
  const confirmed = confirmedOrThrow(await confirmPayment(tx, payment.id, { receipt: money.receipt, paidAmount: money.amountKes, confirmedAt: now }));
  return { paymentId: payment.id, invoiceId: invoice.id, subscriptionId: invoice.subscriptionId, restored: confirmed.restoredListingIds.length };
}

/**
 * Apply to an invoice (decision 8): receipt, amount and phone come from the stored Paybill
 * confirmation, never from the form.
 */
export async function applyPaybillToInvoice(
  deps: AdminDeps,
  actorUserId: string,
  input: { eventId: string; invoiceNumber: string; reason: string },
): Promise<AdminResult> {
  const now = deps.now();
  const result = await run(deps, "apply_paybill", async (tx) => {
    await lockPaybillEvent(tx, input.eventId);
    const found = await getPaybillEvent(tx, input.eventId);
    if (!found || !found.event.transId) throw new Refused("not_found");
    if (found.resolution) throw new Refused("already_resolved");
    const { event } = found;
    if (event.amountKes === null) throw new Refused("amount_mismatch");

    const applied = await applyMoneyToInvoice(tx, now, {
      invoiceNumber: input.invoiceNumber,
      receipt: event.transId!,
      amountKes: event.amountKes,
      phoneE164: event.msisdn ? (normalizeKenyanPhone(event.msisdn)?.e164 ?? null) : null,
      rawCallback: event.payload,
    });
    await recordPaymentEvent(tx, {
      eventType: "admin_resolution",
      paymentId: applied.paymentId,
      invoiceId: applied.invoiceId,
      payload: { sourceEventId: event.id, transId: event.transId, action: "applied", actorUserId },
    });
    await insertBillingAudit(tx, {
      actorUserId,
      action: "apply_paybill",
      reason: input.reason,
      subscriptionId: applied.subscriptionId,
      invoiceId: applied.invoiceId,
      paymentId: applied.paymentId,
      amountKes: event.amountKes,
      reference: event.transId,
    });
    return { ok: true, paymentId: applied.paymentId, restoredListings: applied.restored };
  });
  await sendReceipt(deps, result);
  return result;
}

/** Record a Paybill payment seen on the statement when no callback arrived (decision 9). */
export async function recordPaybillPayment(
  deps: AdminDeps,
  actorUserId: string,
  input: { invoiceNumber: string; receipt: string; amountKes: number; phoneE164: string | null; reason: string },
): Promise<AdminResult> {
  const now = deps.now();
  const result = await run(deps, "record_paybill", async (tx) => {
    const applied = await applyMoneyToInvoice(tx, now, {
      invoiceNumber: input.invoiceNumber,
      receipt: input.receipt,
      amountKes: input.amountKes,
      phoneE164: input.phoneE164,
      rawCallback: null,
    });
    await insertBillingAudit(tx, {
      actorUserId,
      action: "record_paybill",
      reason: input.reason,
      subscriptionId: applied.subscriptionId,
      invoiceId: applied.invoiceId,
      paymentId: applied.paymentId,
      amountKes: input.amountKes,
      reference: input.receipt,
    });
    return { ok: true, paymentId: applied.paymentId, restoredListings: applied.restored };
  });
  await sendReceipt(deps, result);
  return result;
}

/** Record refund for unmatched Paybill money (decision 8). */
export async function refundPaybillEvent(
  deps: AdminDeps,
  actorUserId: string,
  input: { eventId: string; reference: string; amountKes: number; reason: string },
): Promise<AdminResult> {
  return run(deps, "refund_paybill", async (tx) => {
    await lockPaybillEvent(tx, input.eventId);
    const found = await getPaybillEvent(tx, input.eventId);
    if (!found) throw new Refused("not_found");
    if (found.resolution) throw new Refused("already_resolved");
    const { event } = found;
    if (event.amountKes !== null && input.amountKes > event.amountKes) throw new Refused("refund_too_large");
    await recordPaymentEvent(tx, {
      eventType: "admin_resolution",
      payload: { sourceEventId: event.id, transId: event.transId, action: "refunded", reference: input.reference, amountKes: input.amountKes, actorUserId },
    });
    await insertBillingAudit(tx, {
      actorUserId,
      action: "refund_paybill",
      reason: event.transId ? `${input.reason} (Paybill ${event.transId})` : input.reason,
      amountKes: input.amountKes,
      reference: input.reference,
    });
    return { ok: true };
  });
}
