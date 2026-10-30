import "server-only";
import type { DbExecutor } from "@/db/executor";
import {
  getPlan,
  lockInvoice,
  lockPayment,
  lockSubscription,
  ownerOf,
  paidAmountCovering,
  paymentWithReceipt,
  recordPaymentEvent,
  restorePausedListings,
  updatePayment,
  updateSubscription,
  type Payment,
  type Plan,
} from "@/db/queries/payments";
import { invoices } from "@/db/schema";
import { eq } from "drizzle-orm";
import { planChangeAtConfirmation, type PlanTerms } from "@/lib/billing/plan-change";
import { wholeKes } from "./payloads";
import type { ClosedStatus } from "./result-codes";

/**
 * Turning a confirmed payment (M-Pesa or card) into an active plan (prompt S5 decision 7; plan
 * changes from prompt S6 decisions 1–3). Run inside one transaction; rows are locked payment →
 * invoice → subscription, so two callbacks for the same money serialise and the second sees
 * `already_confirmed`. That lock plus the unique receipt or card reference is what stops a
 * replayed callback from extending a plan twice.
 */

export type FlagReason =
  | "amount_mismatch"
  | "duplicate_receipt"
  | "invoice_not_open"
  | "callback_query_mismatch"
  | "missing_receipt";

export type ConfirmOutcome =
  | { outcome: "confirmed"; paymentId: string; periodEnd: Date; restoredListingIds: string[] }
  | { outcome: "already_confirmed" }
  | { outcome: "not_pending"; status: Payment["status"] }
  | { outcome: "not_found" }
  | { outcome: "flagged"; reason: FlagReason };

async function statusChange(
  tx: DbExecutor,
  payment: Pick<Payment, "id" | "invoiceId">,
  payload: Record<string, unknown>,
): Promise<void> {
  await recordPaymentEvent(tx, { eventType: "status_change", paymentId: payment.id, invoiceId: payment.invoiceId, payload });
}

/** Marks a pending payment flagged. Nothing is activated; an admin resolves it (S10). */
export async function flagPayment(
  tx: DbExecutor,
  payment: Payment,
  reason: FlagReason,
  paidAmountKes: number | null = payment.paidAmountKes,
): Promise<ConfirmOutcome> {
  await updatePayment(tx, payment.id, { status: "flagged", flagReason: reason, paidAmountKes });
  await statusChange(tx, payment, { entity: "payment", from: payment.status, to: "flagged", reason });
  return { outcome: "flagged", reason };
}

/** Locks a pending payment and flags it (callback and query disagree, missing receipt). */
export async function flagPendingPayment(tx: DbExecutor, paymentId: string, reason: FlagReason): Promise<ConfirmOutcome> {
  const payment = await lockPayment(tx, paymentId);
  if (!payment) return { outcome: "not_found" };
  if (payment.status !== "pending") return { outcome: "not_pending", status: payment.status };
  return flagPayment(tx, payment, reason);
}

/** A failed or cancelled STK payment, once the query agrees with the callback. */
export async function closePayment(
  tx: DbExecutor,
  paymentId: string,
  status: ClosedStatus,
): Promise<{ outcome: "closed"; status: ClosedStatus } | Extract<ConfirmOutcome, { outcome: "not_pending" | "not_found" }>> {
  const payment = await lockPayment(tx, paymentId);
  if (!payment) return { outcome: "not_found" };
  if (payment.status !== "pending") return { outcome: "not_pending", status: payment.status };
  // Failed attempts never hold a receipt; Safaricom sends none, but be certain.
  await updatePayment(tx, payment.id, { status, mpesaReceipt: null });
  await statusChange(tx, payment, { entity: "payment", from: payment.status, to: status, resultCode: payment.resultCode });
  return { outcome: "closed", status };
}

export interface ConfirmInput {
  /** The M-Pesa receipt; null for card payments, whose identity is their unique provider reference. */
  receipt: string | null;
  paidAmount: number | null;
  confirmedAt: Date;
  /** Card display details from the gateway, stored with the confirmation. */
  card?: { brand: string | null; last4: string | null };
}

function terms(plan: Plan): PlanTerms {
  return { id: plan.id, code: plan.code, name: plan.name, priceKes: plan.priceKes, listingLimit: plan.listingLimit };
}

export async function confirmPayment(
  tx: DbExecutor,
  paymentId: string,
  { receipt, paidAmount, confirmedAt, card }: ConfirmInput,
): Promise<ConfirmOutcome> {
  const payment = await lockPayment(tx, paymentId);
  if (!payment) return { outcome: "not_found" };
  if (payment.status === "confirmed") return { outcome: "already_confirmed" };
  if (payment.status !== "pending") return { outcome: "not_pending", status: payment.status };

  const paidAmountKes = wholeKes(paidAmount);
  if (receipt && (await paymentWithReceipt(tx, receipt, payment.id))) {
    return flagPayment(tx, payment, "duplicate_receipt", paidAmountKes);
  }

  const invoice = await lockInvoice(tx, payment.invoiceId);
  if (!invoice || invoice.status !== "open") return flagPayment(tx, payment, "invoice_not_open", paidAmountKes);
  if (paidAmountKes === null || paidAmountKes !== invoice.amountKes) {
    return flagPayment(tx, payment, "amount_mismatch", paidAmountKes);
  }

  const sub = await lockSubscription(tx, invoice.subscriptionId);
  const [currentPlan, invoicePlan] = sub ? await Promise.all([getPlan(tx, sub.planId), getPlan(tx, invoice.planId)]) : [];
  if (!sub || !currentPlan || !invoicePlan) return flagPayment(tx, payment, "invoice_not_open", paidAmountKes);

  const change = planChangeAtConfirmation({
    subscription: sub,
    currentPlan: terms(currentPlan),
    invoicePlan: terms(invoicePlan),
    confirmedAt,
    coveringPaidAmountKes: await paidAmountCovering(tx, sub.id, confirmedAt),
  });

  await updatePayment(tx, payment.id, {
    status: "confirmed",
    paidAmountKes,
    confirmedAt,
    ...(receipt ? { mpesaReceipt: receipt } : {}),
    ...(card ? { cardBrand: card.brand, cardLast4: card.last4 } : {}),
  });
  await tx
    .update(invoices)
    .set({ status: "paid", paidAt: confirmedAt, periodStart: change.periodStart, periodEnd: change.periodEnd })
    .where(eq(invoices.id, invoice.id));
  await updateSubscription(tx, sub.id, {
    status: "active",
    planId: change.planId,
    currentPeriodStart: change.currentPeriodStart,
    currentPeriodEnd: change.periodEnd,
    graceEndsAt: change.graceEndsAt,
    scheduledPlanId: change.scheduledPlanId,
    scheduledChangeAt: change.scheduledChangeAt,
  });

  // The plan in force now: a schedule only ever points at a later date here.
  let restoredListingIds: string[] = [];
  const plan = change.planId === invoicePlan.id ? invoicePlan : currentPlan;
  if (plan.kind === "listing" && plan.listingLimit !== null) {
    restoredListingIds = await restorePausedListings(tx, ownerOf(sub), plan.listingLimit, confirmedAt);
  }

  await statusChange(tx, payment, { entity: "payment", from: payment.status, to: "confirmed", receipt: receipt ?? payment.providerReference });
  await statusChange(tx, payment, { entity: "invoice", from: invoice.status, to: "paid" });
  await statusChange(tx, payment, {
    entity: "subscription",
    subscriptionId: sub.id,
    from: sub.status,
    to: "active",
    change: change.kind,
    planFrom: sub.planId,
    planTo: change.planId,
    scheduledPlanId: change.scheduledPlanId,
    creditDays: change.creditDays,
    periodEnd: change.periodEnd.toISOString(),
    restoredListings: restoredListingIds.length,
  });
  return { outcome: "confirmed", paymentId: payment.id, periodEnd: change.periodEnd, restoredListingIds };
}
