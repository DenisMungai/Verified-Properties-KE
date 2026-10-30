import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { billingReminders, paymentEvents, payments, plans, properties, subscriptions } from "@/db/schema";
import { ACTIVE_LISTING_STATUSES, PAID_SUBSCRIPTION_STATUSES } from "@/lib/billing/constants";
import type { ListingPool } from "./billing";

/**
 * Candidate selects for the S9 jobs. Each returns only rows still in their "to do" state; the job
 * then locks and re-checks every row before writing, so these reads may be slightly stale.
 */

/** Statuses that hold an owner's single live subscription slot (matches the partial unique index). */
const LIVE_STATUSES = ["pending", "active", "past_due", "paused"] as const;

/** Paid subscriptions whose grace has ended (decision 5), oldest first. */
export async function lapsingSubscriptionIds(db: DbExecutor, now: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, [...PAID_SUBSCRIPTION_STATUSES]), lte(subscriptions.graceEndsAt, now)))
    .orderBy(asc(subscriptions.graceEndsAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Listing subscriptions whose downgrade took effect at or before `changedBy` (decision 6). */
export async function dueDowngradeIds(db: DbExecutor, changedBy: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.kind, "listing"),
        inArray(subscriptions.status, [...LIVE_STATUSES]),
        isNotNull(subscriptions.scheduledPlanId),
        lte(subscriptions.scheduledChangeAt, changedBy),
      ),
    )
    .orderBy(asc(subscriptions.scheduledChangeAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** The pool's slot-using listings with their publish dates, locked for the auto-pick. */
export async function lockPoolActiveListings(tx: DbExecutor, pool: ListingPool) {
  const owner = pool.kind === "agency" ? eq(properties.agencyId, pool.agencyId) : eq(properties.ownerUserId, pool.userId);
  return tx
    .select({ id: properties.id, status: properties.status, publishedAt: properties.publishedAt })
    .from(properties)
    .where(and(owner, inArray(properties.status, [...ACTIVE_LISTING_STATUSES])))
    .for("update");
}

export interface ReminderCandidate {
  subscriptionId: string;
  ownerUserId: string | null;
  ownerAgencyId: string | null;
  periodEnd: Date;
  /** The plan in force at the period end: what renewing charges (S6 decision 3). */
  planCode: string;
  planName: string;
  priceKes: number;
}

/** A reminder row is finished unless it failed and still has attempts left (decision 8). */
export const REMINDER_MAX_ATTEMPTS = 3;

/**
 * Paid listing plans ending within `(now, until]` that still have an unfinished reminder for the
 * window they are in: "1d" inside the last day, otherwise "5d" (decision 7).
 */
export async function reminderCandidates(db: DbExecutor, now: Date, until: Date, oneDayBefore: Date, limit: number): Promise<ReminderCandidate[]> {
  const effectivePlanAtEnd = sql`case when ${subscriptions.scheduledChangeAt} <= ${subscriptions.currentPeriodEnd}
    then ${subscriptions.scheduledPlanId} else ${subscriptions.planId} end`;
  const windowReminder = sql`case when ${subscriptions.currentPeriodEnd} <= ${oneDayBefore.toISOString()}::timestamptz then '1d' else '5d' end`;
  const finishedChannels = sql<number>`(
    select count(*)::int from ${billingReminders}
    where ${billingReminders.subscriptionId} = ${subscriptions.id}
      and ${billingReminders.periodEnd} = ${subscriptions.currentPeriodEnd}
      and ${billingReminders.reminder} = ${windowReminder}
      and (${billingReminders.status} <> 'failed' or ${billingReminders.attempts} >= ${REMINDER_MAX_ATTEMPTS})
  )`;
  const rows = await db
    .select({
      subscriptionId: subscriptions.id,
      ownerUserId: subscriptions.ownerUserId,
      ownerAgencyId: subscriptions.ownerAgencyId,
      periodEnd: subscriptions.currentPeriodEnd,
      planCode: plans.code,
      planName: plans.name,
      priceKes: plans.priceKes,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, effectivePlanAtEnd))
    .where(
      and(
        eq(subscriptions.kind, "listing"),
        inArray(subscriptions.status, [...PAID_SUBSCRIPTION_STATUSES]),
        gt(subscriptions.currentPeriodEnd, now),
        lte(subscriptions.currentPeriodEnd, until),
        sql`${finishedChannels} < 2`,
      ),
    )
    .orderBy(asc(subscriptions.currentPeriodEnd))
    .limit(limit);
  return rows.filter((row): row is ReminderCandidate => row.periodEnd !== null);
}

/** Pending STK payments whose callback was stored at or before `callbackBy` but never settled. */
export async function unsettledStkPaymentIds(db: DbExecutor, callbackBy: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.method, "stk_push"),
        eq(payments.status, "pending"),
        isNotNull(payments.rawCallback),
        lte(payments.updatedAt, callbackBy),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Pending STK payments with no callback, started within `[since, startedBy]`, newest first. */
export async function noCallbackStkPaymentIds(db: DbExecutor, since: Date, startedBy: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.method, "stk_push"),
        eq(payments.status, "pending"),
        isNull(payments.rawCallback),
        gt(payments.createdAt, since),
        lte(payments.createdAt, startedBy),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/**
 * Pending card payments started within `[since, startedBy]` with no Verify since `verifiedBefore`,
 * newest first, with their start time so the job can tell stale ones apart.
 */
export async function pendingCardPayments(
  db: DbExecutor,
  { since, startedBy, verifiedBefore, limit }: { since: Date; startedBy: Date; verifiedBefore: Date; limit: number },
): Promise<{ id: string; createdAt: Date }[]> {
  return db
    .select({ id: payments.id, createdAt: payments.createdAt })
    .from(payments)
    .where(
      and(
        eq(payments.method, "card"),
        eq(payments.status, "pending"),
        gt(payments.createdAt, since),
        lte(payments.createdAt, startedBy),
        sql`not exists (
          select 1 from ${paymentEvents}
          where ${paymentEvents.paymentId} = ${payments.id}
            and ${paymentEvents.eventType} = 'card_verify'
            and ${paymentEvents.createdAt} > ${verifiedBefore.toISOString()}::timestamptz
        )`,
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(limit);
}
