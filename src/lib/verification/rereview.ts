import "server-only";
import type { DbExecutor } from "@/db/executor";
import { getListingPool, getListingSubscription } from "@/db/queries/billing";
import {
  getLastApprovedRequest,
  getLatestRequest,
  getOpenRequest,
  getVerificationSubscription,
  insertAudit,
  insertRequest,
  type VerificationRequest,
} from "@/db/queries/verification";
import { subscriptionPhase } from "@/lib/billing/periods";
import { canStartRereview, REREVIEW_MESSAGES, type RereviewFacts, type RereviewRefusal } from "./rules";

/**
 * Re-review (prompt S13 decisions 3–4): a lister whose approved review is ending (or has ended)
 * and whose verification and listing plans are in good standing starts a fresh review at no extra
 * charge. It opens straight in `documents_pending`; their current review keeps the badge until it
 * ends. Only an admin's approval ever sets `verified`.
 */

export interface RereviewState {
  facts: RereviewFacts;
  lastApproved: VerificationRequest | null;
}

const inGoodStanding = (phase: string) => phase === "active" || phase === "grace";

/** Reads everything `canStartRereview` needs, for `userId` only. Pass `lock` inside a transaction. */
export async function loadRereviewState(db: DbExecutor, userId: string, now: Date, lock = false): Promise<RereviewState> {
  // In turn, not Promise.all: inside a transaction they share one connection.
  const open = await getOpenRequest(db, userId, lock);
  const latest = await getLatestRequest(db, userId);
  const lastApproved = await getLastApprovedRequest(db, userId);
  const verification = await getVerificationSubscription(db, userId);
  const listing = await getListingSubscription(db, await getListingPool(db, userId), now);
  return {
    lastApproved,
    facts: {
      lastApproved: lastApproved ? { status: lastApproved.status, reviewExpiresAt: lastApproved.reviewExpiresAt } : null,
      hasOpenRequest: open !== null,
      latestStatus: latest?.status ?? null,
      verificationPlanOk: verification ? inGoodStanding(subscriptionPhase(verification.subscription, now)) : false,
      listingPlanOk: listing ? inGoodStanding(subscriptionPhase(listing.subscription, now)) : false,
    },
  };
}

export type RereviewResult = { ok: true; requestId: string } | { ok: false; code: RereviewRefusal; message: string };

/** Opens the re-review in one transaction, re-checking eligibility there. */
export async function startRereview(
  deps: { withTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>; now: () => Date },
  userId: string,
): Promise<RereviewResult> {
  return deps.withTransaction(async (tx) => {
    const now = deps.now();
    const { facts, lastApproved } = await loadRereviewState(tx, userId, now, true);
    const check = canStartRereview(facts, now);
    if (!check.ok) return { ok: false, code: check.code, message: REREVIEW_MESSAGES[check.code] };
    if (!lastApproved) return { ok: false, code: "no_approved_review", message: REREVIEW_MESSAGES.no_approved_review };
    const request = await insertRequest(tx, {
      listerUserId: userId,
      status: "documents_pending",
      invoiceId: null,
      renewsRequestId: lastApproved.id,
    });
    await insertAudit(tx, { requestId: request.id, actorUserId: userId, action: "rereview" });
    return { ok: true, requestId: request.id };
  });
}
