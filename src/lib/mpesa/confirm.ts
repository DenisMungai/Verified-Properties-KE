import "server-only";
import type { DbExecutor } from "@/db/executor";
import {
  getPlan,
  lockInvoice,
  lockPayment,
  lockSubscription,
  ownerOf,
  paymentWithReceipt,
  recordPaymentEvent,
  restorePausedListings,
  updatePayment,
  type Payment,
} from "@/db/queries/payments";
import { invoices, subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PAID_SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "@/lib/billing/constants";
import { nextPeriod } from "@/lib/billing/periods";
import { wholeKes } from "./payloads";
import type { ClosedStatus } from "./result-codes";

/**
 * Turning a Safaricom-confirmed payment into an active plan (prompt S5 decision 7). Run inside
 * one transaction; rows are locked payment → invoice → subscription, so two callbacks for the
 * same money serialise and the second sees `already_confirmed`. That lock plus the unique
 * receipt is what stops a replayed callback from extending a plan twice.
 */

export type FlagReason =
  | "amount_mismatch"
  | "duplicate_receipt"
  | "invoice_not_open"
  | "callback_query_mismatch"
  | "missing_receipt";

export type ConfirmOutcome =
  | { outcome: "confirmed"; periodEnd: Date; restoredListingIds: string[] }
  | { outcome: "already_confirmed" }
  | { outcome: "not_pending"; status: Payment["status"] }
  | { outcome: "not_found" }
  | { outcome: "flagged"; reason: FlagReason };

function isPaid(status: SubscriptionStatus): boolean {
  return (PAID_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(status);
}

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

export async function confirmPayment(
  tx: DbExecutor,
  paymentId: string,
  { receipt, paidAmount, confirmedAt }: { receipt: string; paidAmount: number | null; confirmedAt: Date },
): Promise<ConfirmOutcome> {
  const payment = await lockPayment(tx, paymentId);
  if (!payment) return { outcome: "not_found" };
  if (payment.status === "confirmed") return { outcome: "already_confirmed" };
  if (payment.status !== "pending") return { outcome: "not_pending", status: payment.status };

  const paidAmountKes = wholeKes(paidAmount);
  if (await paymentWithReceipt(tx, receipt, payment.id)) {
    return flagPayment(tx, payment, "duplicate_receipt", paidAmountKes);
  }

  const invoice = await lockInvoice(tx, payment.invoiceId);
  if (!invoice || invoice.status !== "open") return flagPayment(tx, payment, "invoice_not_open", paidAmountKes);
  if (paidAmountKes === null || paidAmountKes !== invoice.amountKes) {
    return flagPayment(tx, payment, "amount_mismatch", paidAmountKes);
  }

  const sub = await lockSubscription(tx, invoice.subscriptionId);
  if (!sub) return flagPayment(tx, payment, "invoice_not_open", paidAmountKes);

  const paid = isPaid(sub.status);
  const period = nextPeriod({ confirmedAt, currentPeriodEnd: paid ? sub.currentPeriodEnd : null });
  const continuous = paid && sub.currentPeriodEnd?.getTime() === period.start.getTime();

  await updatePayment(tx, payment.id, { status: "confirmed", mpesaReceipt: receipt, paidAmountKes, confirmedAt });
  await tx
    .update(invoices)
    .set({ status: "paid", paidAt: confirmedAt, periodStart: period.start, periodEnd: period.end })
    .where(eq(invoices.id, invoice.id));
  await tx
    .update(subscriptions)
    .set({
      status: "active",
      currentPeriodStart: continuous && sub.currentPeriodStart ? sub.currentPeriodStart : period.start,
      currentPeriodEnd: period.end,
      graceEndsAt: period.graceEndsAt,
    })
    .where(eq(subscriptions.id, sub.id));

  let restoredListingIds: string[] = [];
  const plan = await getPlan(tx, sub.planId);
  if (plan?.kind === "listing" && plan.listingLimit !== null) {
    restoredListingIds = await restorePausedListings(tx, ownerOf(sub), plan.listingLimit, confirmedAt);
  }

  await statusChange(tx, payment, { entity: "payment", from: payment.status, to: "confirmed", receipt });
  await statusChange(tx, payment, { entity: "invoice", from: invoice.status, to: "paid" });
  await statusChange(tx, payment, {
    entity: "subscription",
    subscriptionId: sub.id,
    from: sub.status,
    to: "active",
    periodEnd: period.end.toISOString(),
    restoredListings: restoredListingIds.length,
  });
  return { outcome: "confirmed", periodEnd: period.end, restoredListingIds };
}
