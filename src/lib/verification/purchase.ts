import "server-only";
import type { DbExecutor } from "@/db/executor";
import { getListingPool, getListingSubscription } from "@/db/queries/billing";
import {
  getLatestRequest,
  getOpenRequest,
  getUnexpiredVerifiedRequest,
  insertAudit,
  insertRequest,
  updateRequest,
} from "@/db/queries/verification";
import { subscriptionPhase } from "@/lib/billing/periods";

/**
 * Paying for verification (prompt S12 decisions 3–5). Paying never grants the badge: it opens a
 * review (or, with an unexpired approved review, only renews the badge subscription).
 */

/** Audit reason on the `pay` row a renewal writes. */
export const RENEWAL_REASON = "Renewal";

export type VerificationPurchaseRefusal =
  | "listing_plan_required"
  | "verification_in_progress"
  | "verification_suspended";

export const VERIFICATION_PURCHASE_MESSAGES: Record<VerificationPurchaseRefusal, string> = {
  listing_plan_required: "Verification needs an active listing plan. Renew or choose a plan first.",
  verification_in_progress: "Your verification is already paid for. Upload your documents or wait for the review.",
  verification_suspended: "Your verification is suspended. Contact support before applying again.",
};

/** Whether this lister may pay for verification right now. Lister profile is checked by the caller. */
export async function checkVerificationPurchase(
  db: DbExecutor,
  userId: string,
  now: Date,
): Promise<{ ok: true } | { ok: false; code: VerificationPurchaseRefusal }> {
  const listing = await getListingSubscription(db, await getListingPool(db, userId), now);
  const phase = listing ? subscriptionPhase(listing.subscription, now) : "lapsed";
  if (phase !== "active" && phase !== "grace") return { ok: false, code: "listing_plan_required" };

  const [open, latest] = await Promise.all([getOpenRequest(db, userId), getLatestRequest(db, userId)]);
  if (open && open.status !== "payment_pending") return { ok: false, code: "verification_in_progress" };
  if (latest?.status === "suspended") return { ok: false, code: "verification_suspended" };
  return { ok: true };
}

/**
 * Inside the checkout transaction, once the verification invoice exists: opens (or reuses) the
 * lister's `payment_pending` request and points it at this invoice. A lister with an unexpired
 * approved review gets no request: paying just renews the badge subscription.
 */
export async function attachVerificationInvoice(tx: DbExecutor, userId: string, invoiceId: string, now: Date): Promise<void> {
  if (await getUnexpiredVerifiedRequest(tx, userId, now)) return;
  const open = await getOpenRequest(tx, userId, true);
  if (open) {
    if (open.status === "payment_pending" && open.invoiceId !== invoiceId) await updateRequest(tx, open.id, { invoiceId });
    return;
  }
  const request = await insertRequest(tx, { listerUserId: userId, status: "payment_pending", invoiceId });
  await insertAudit(tx, { requestId: request.id, actorUserId: userId, action: "start" });
}

/**
 * Inside the payment-confirmation transaction for a verification plan: the request moves on to
 * `documents_pending`. Idempotent: a repeated callback finds nothing left to move. With no open
 * request (a Paybill payment against the invoice), one is created. A lister with an unexpired
 * approved review is only renewing: the review is untouched and a `pay` row with reason "Renewal"
 * goes on that review's audit log (S17 exit fix F2). Repeated callbacks never get here twice:
 * `confirmPayment` stops at a payment that is no longer pending.
 */
export async function onVerificationPaid(tx: DbExecutor, userId: string, invoiceId: string, confirmedAt: Date): Promise<void> {
  const verified = await getUnexpiredVerifiedRequest(tx, userId, confirmedAt);
  if (verified) {
    await insertAudit(tx, { requestId: verified.id, actorUserId: userId, action: "pay", reason: RENEWAL_REASON });
    return;
  }
  // A suspended lister never reopens verification by paying; support has to lift it first.
  // (Suspension voids open invoices, so this is a second line of defence.)
  if ((await getLatestRequest(tx, userId))?.status === "suspended") return;
  const open = await getOpenRequest(tx, userId, true);
  if (open && open.status !== "payment_pending") return;
  const request = open ?? (await insertRequest(tx, { listerUserId: userId, status: "payment_pending", invoiceId }));
  await updateRequest(tx, request.id, { status: "documents_pending", invoiceId });
  await insertAudit(tx, { requestId: request.id, actorUserId: userId, action: "pay" });
}
