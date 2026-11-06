import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { getListingPool, getListingSubscription } from "@/db/queries/billing";
import { insertBillingAudit } from "@/db/queries/billing-admin";
import { lockSubscription, openInvoices, updateSubscription, voidInvoices } from "@/db/queries/payments";
import { getOpenRequest, insertAudit, lockRequest, updateRequest, type VerificationRequest } from "@/db/queries/verification";
import { lockOtherVerifiedRequests } from "@/db/queries/verification-lifecycle";
import { payments, subscriptions } from "@/db/schema";
import { canReceiveCredit, creditDaysFromPayment, extendPeriodByDays } from "@/lib/billing/credit";
import { canTransition, requestNumber, reviewExpiresAt, type VerificationStatus } from "./rules";

/**
 * Admin decisions on a verification request (prompt S12 decisions 8 and 9). The caller has already
 * checked `platform_admin`; the admin id comes from the session. Each decision locks the request,
 * checks the expected status (so a double submit or two admins racing change nothing the second
 * time), refuses self-review, and writes its audit row in the same transaction.
 */

export interface DecisionDeps {
  withTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  now: () => Date;
}

export type DecisionRefusal = "not_found" | "conflict" | "self_review";

export const DECISION_MESSAGES: Record<DecisionRefusal, string> = {
  not_found: "We couldn't find that verification request.",
  conflict: "Someone already decided this. Reload to see the latest.",
  self_review: "You can't decide on your own verification. Ask another admin.",
};

/** What happened to the fee on a rejection. */
export type CreditOutcome = { kind: "credited"; days: number } | { kind: "skipped"; cause: CreditSkipCause };
export type CreditSkipCause = "no_payment" | "listing_plan_inactive" | "credit_too_small";

export const CREDIT_SKIP_LABELS: Record<CreditSkipCause, string> = {
  no_payment: "no confirmed payment was found for this review",
  listing_plan_inactive: "the lister's listing plan isn't active",
  credit_too_small: "the fee is worth less than one day of the listing plan",
};

export type DecisionResult =
  | { ok: true; listerUserId: string; credit?: CreditOutcome; /** A re-review (S13): no fee, so no credit. */ rereview?: boolean }
  | { ok: false; code: DecisionRefusal; message: string };

const refuse = (code: DecisionRefusal): DecisionResult => ({ ok: false, code, message: DECISION_MESSAGES[code] });

type Decision = "approve" | "request_changes" | "reject" | "suspend";

const EXPECTED: Record<Decision, { from: VerificationStatus; to: VerificationStatus }> = {
  approve: { from: "under_review", to: "verified" },
  request_changes: { from: "under_review", to: "documents_pending" },
  reject: { from: "under_review", to: "rejected" },
  suspend: { from: "verified", to: "suspended" },
};

async function decide(
  deps: DecisionDeps,
  decision: Decision,
  adminId: string,
  requestId: string,
  apply: (tx: DbExecutor, request: VerificationRequest, now: Date) => Promise<CreditOutcome | void>,
): Promise<DecisionResult> {
  const { from, to } = EXPECTED[decision];
  return deps.withTransaction(async (tx) => {
    const request = await lockRequest(tx, requestId);
    if (!request) return refuse("not_found");
    if (request.listerUserId === adminId) return refuse("self_review");
    if (request.status !== from || !canTransition(from, to)) return refuse("conflict");
    const credit = await apply(tx, request, deps.now());
    return {
      ok: true,
      listerUserId: request.listerUserId,
      ...(credit ? { credit } : {}),
      ...(request.renewsRequestId ? { rereview: true } : {}),
    };
  });
}

export function approveRequest(deps: DecisionDeps, adminId: string, requestId: string): Promise<DecisionResult> {
  return decide(deps, "approve", adminId, requestId, async (tx, request, now) => {
    await updateRequest(tx, request.id, {
      status: "verified",
      decidedAt: now,
      decidedBy: adminId,
      decisionReason: null,
      reviewExpiresAt: reviewExpiresAt(now),
    });
    await insertAudit(tx, { requestId: request.id, actorUserId: adminId, action: "approve" });
    // S13 decision 5: the new review replaces any older one, so the expiry job and the re-review
    // reminders never act on a review that no longer counts.
    for (const older of await lockOtherVerifiedRequests(tx, request.listerUserId, request.id)) {
      if (!canTransition(older.status, "expired")) continue;
      await updateRequest(tx, older.id, { status: "expired", endedAt: now });
      await insertAudit(tx, {
        requestId: older.id,
        actorUserId: adminId,
        action: "supersede",
        reason: `Replaced by ${requestNumber(request.id)}`,
      });
    }
  });
}

export function requestChanges(deps: DecisionDeps, adminId: string, requestId: string, reason: string): Promise<DecisionResult> {
  return decide(deps, "request_changes", adminId, requestId, async (tx, request) => {
    await updateRequest(tx, request.id, { status: "documents_pending", decisionReason: reason });
    await insertAudit(tx, { requestId: request.id, actorUserId: adminId, action: "request_changes", reason });
  });
}

export function suspendRequest(deps: DecisionDeps, adminId: string, requestId: string, reason: string): Promise<DecisionResult> {
  return decide(deps, "suspend", adminId, requestId, async (tx, request, now) => {
    await updateRequest(tx, request.id, { status: "suspended", decidedAt: now, decidedBy: adminId, decisionReason: reason });
    await insertAudit(tx, { requestId: request.id, actorUserId: adminId, action: "suspend", reason });
    // S13 decision 6: a re-review in progress is closed too; a suspended lister can't be re-approved
    // by finishing it.
    const open = await getOpenRequest(tx, request.listerUserId, true);
    if (open && canTransition(open.status, "rejected")) {
      await updateRequest(tx, open.id, { status: "rejected", decidedAt: now, decidedBy: adminId, decisionReason: SUSPENSION_CLOSURE_REASON });
      await insertAudit(tx, { requestId: open.id, actorUserId: adminId, action: "reject", reason: SUSPENSION_CLOSURE_REASON });
    }
    // No more billing for a badge the lister can't have; a late payment on a voided invoice is
    // flagged for a billing admin instead of reopening verification.
    await endVerificationBilling(tx, request.listerUserId, now);
  });
}

export const SUSPENSION_CLOSURE_REASON = "Closed because verification was suspended.";

export function rejectRequest(deps: DecisionDeps, adminId: string, requestId: string, reason: string): Promise<DecisionResult> {
  return decide(deps, "reject", adminId, requestId, async (tx, request, now) => {
    await updateRequest(tx, request.id, { status: "rejected", decidedAt: now, decidedBy: adminId, decisionReason: reason });
    await insertAudit(tx, { requestId: request.id, actorUserId: adminId, action: "reject", reason });
    // S13 decision 6: a re-review was never paid for, so there is nothing to credit, and the
    // current review keeps its badge (and its billing) until it ends.
    if (request.renewsRequestId) return;
    const credit = await creditRejectedFee(tx, adminId, request, now);
    await insertAudit(tx, {
      requestId: request.id,
      actorUserId: adminId,
      action: credit.kind === "credited" ? "credit" : "credit_skipped",
      reason: credit.kind === "credited" ? `${credit.days} days added to the listing plan` : CREDIT_SKIP_LABELS[credit.cause],
    });
    await endVerificationBilling(tx, request.listerUserId, now);
    return credit;
  });
}

/**
 * Rejected review (decision 9): the fee paid for this request becomes days on the lister's listing
 * plan, once. Runs inside the rejection's transaction, which is what makes "once" hold.
 */
async function creditRejectedFee(tx: DbExecutor, adminId: string, request: VerificationRequest, now: Date): Promise<CreditOutcome> {
  if (!request.invoiceId) return { kind: "skipped", cause: "no_payment" };
  const [payment] = await tx
    .select({ id: payments.id, paidAmountKes: payments.paidAmountKes })
    .from(payments)
    .where(and(eq(payments.invoiceId, request.invoiceId), eq(payments.status, "confirmed")))
    .limit(1);
  if (!payment?.paidAmountKes) return { kind: "skipped", cause: "no_payment" };

  const listing = await getListingSubscription(tx, await getListingPool(tx, request.listerUserId), now);
  const sub = listing ? await lockSubscription(tx, listing.subscription.id) : null;
  if (!listing || !sub || !sub.currentPeriodEnd || !canReceiveCredit(sub, now)) {
    return { kind: "skipped", cause: "listing_plan_inactive" };
  }
  const days = creditDaysFromPayment(payment.paidAmountKes, listing.plan.priceKes);
  if (days === 0) return { kind: "skipped", cause: "credit_too_small" };

  await updateSubscription(
    tx,
    sub.id,
    extendPeriodByDays({ status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, scheduledChangeAt: sub.scheduledChangeAt }, days, now),
  );
  await insertBillingAudit(tx, {
    actorUserId: adminId,
    action: "verification_credit",
    reason: "Verification rejected: the fee was credited to the listing plan.",
    subscriptionId: sub.id,
    invoiceId: request.invoiceId,
    paymentId: payment.id,
    amountKes: payment.paidAmountKes,
    creditDays: days,
  });
  return { kind: "credited", days };
}

/**
 * Rejection and suspension end the lister's verification billing: the live verification
 * subscription is cancelled (no renewal reminders) and its open invoices are voided, so a payment
 * that arrives later is flagged as `invoice_not_open` instead of being applied.
 */
async function endVerificationBilling(tx: DbExecutor, listerUserId: string, now: Date): Promise<void> {
  const live = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.ownerUserId, listerUserId),
        eq(subscriptions.kind, "verification"),
        inArray(subscriptions.status, ["pending", "active", "past_due", "paused"]),
      ),
    )
    .for("update");
  for (const sub of live) {
    await voidInvoices(tx, (await openInvoices(tx, sub.id)).map((invoice) => invoice.id), now);
    await tx.update(subscriptions).set({ status: "cancelled", cancelledAt: now }).where(eq(subscriptions.id, sub.id));
  }
}
