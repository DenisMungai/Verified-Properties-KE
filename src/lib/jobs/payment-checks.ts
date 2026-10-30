import "server-only";
import { noCallbackStkPaymentIds, pendingCardPayments, unsettledStkPaymentIds } from "@/db/queries/jobs";
import { DAY_MS } from "@/lib/billing/constants";
import { closeStaleCardPayment, DECLINED_STATUSES, settleCardPayment } from "@/lib/card/settle-card";
import { settleStkPayment, settleStkWithoutCallback } from "@/lib/mpesa/settle";
import { Counter } from "./counter";
import type { JobDeps, JobResult } from "./types";

/**
 * Payments the callback path left pending (prompt S9 decision 11). Every settle goes through the
 * S5/S6 rules: STK needs the callback and the query to agree (the query alone only ever closes or
 * flags), and a card needs Paystack's Verify. Nothing here confirms on its own say-so.
 */

const MINUTE_MS = 60 * 1000;

/** The callback route's after() should have settled by now (matches the status poller). */
export const STK_SETTLE_AFTER_MS = 2 * MINUTE_MS;
/** An STK prompt times out within about a minute; past this, the missing callback is checked. */
export const STK_NO_CALLBACK_AFTER_MS = 5 * MINUTE_MS;
export const CARD_VERIFY_AFTER_MS = 15 * MINUTE_MS;
/** A card attempt still open after this is closed once Verify still says it didn't succeed. */
export const CARD_STALE_AFTER_MS = DAY_MS;
/** Older pending payments are left to reconciliation's `stuck_pending` list. */
export const CHECK_WINDOW_MS = 3 * DAY_MS;

/** STK settles wait between queries, so each run handles a few of each. */
const STK_BATCH = 10;
const CARD_BATCH = 10;

async function checkStk(deps: JobDeps, now: Date, counter: Counter): Promise<void> {
  const payments = deps.payments;
  if (!payments) {
    counter.add("stkSkippedNotConfigured");
    return;
  }
  const t = now.getTime();
  const limit = deps.batchSize ?? STK_BATCH;
  const withCallback = await unsettledStkPaymentIds(deps.db, new Date(t - STK_SETTLE_AFTER_MS), limit);
  await counter.each(withCallback, (id) => id, async (id) => {
    const result = await settleStkPayment(payments, id);
    counter.add(`stk_${result.outcome}`);
  });
  const noCallback = await noCallbackStkPaymentIds(deps.db, new Date(t - CHECK_WINDOW_MS), new Date(t - STK_NO_CALLBACK_AFTER_MS), limit);
  await counter.each(noCallback, (id) => id, async (id) => {
    const result = await settleStkWithoutCallback(payments, id);
    counter.add(`stkNoCallback_${result.outcome}`);
  });
}

async function checkCards(deps: JobDeps, now: Date, counter: Counter): Promise<void> {
  const card = deps.card;
  if (!card) {
    counter.add("cardSkippedNotConfigured");
    return;
  }
  const t = now.getTime();
  const pending = await pendingCardPayments(deps.db, {
    since: new Date(t - CHECK_WINDOW_MS),
    startedBy: new Date(t - CARD_VERIFY_AFTER_MS),
    verifiedBefore: new Date(t - CARD_VERIFY_AFTER_MS),
    limit: deps.batchSize ?? CARD_BATCH,
  });
  await counter.each(pending, (p) => p.id, async (payment) => {
    const result = await settleCardPayment(card, payment.id, "job");
    counter.add(`card_${result.outcome}`);
    const stale = t - payment.createdAt.getTime() >= CARD_STALE_AFTER_MS;
    if (!stale || (result.outcome !== "declined" && result.outcome !== "not_ready")) return;
    // Paystack's "ongoing"/"pending" a day later means the payer never finished: treat as failed.
    const gatewayStatus = result.gatewayStatus;
    const closed = await closeStaleCardPayment(card, payment.id, DECLINED_STATUSES.has(gatewayStatus) ? gatewayStatus : "failed");
    counter.add(closed.outcome === "closed" ? `cardStaleClosed_${closed.status}` : `cardStale_${closed.outcome}`);
  });
}

export async function runPaymentChecks(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const counter = new Counter("payment-checks");
  await checkStk(deps, now, counter);
  await checkCards(deps, now, counter);
  return { status: "ok", counts: counter.counts };
}
