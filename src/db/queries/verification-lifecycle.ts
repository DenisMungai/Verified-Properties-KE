import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { listerProfiles, users, verificationDocuments, verificationReminders, verificationRequests } from "@/db/schema";
import { REMINDER_MAX_ATTEMPTS } from "./jobs";
import {
  RETENTION_DAYS_AFTER_END,
  RETENTION_DAYS_AFTER_REJECTION,
  RETENTION_MONTHS_AFTER_SUSPENSION,
} from "@/lib/verification/retention";
import { OPEN_STATUSES, REREVIEW_WINDOW_DAYS } from "@/lib/verification/rules";
import type { VerificationRequest } from "./verification";

/**
 * Verification lifecycle data access (prompt S13 decision 7): candidates for the expiry,
 * re-review reminder and retention steps, the reminder claim/finish bookkeeping, and the writes
 * that replace or purge a request. Every candidate list is re-checked under a row lock before
 * anything is written.
 */

const vr = verificationRequests;
const vd = verificationDocuments;
const rem = verificationReminders;

/* -------------------------------------------------------------------------- */
/* Candidates                                                                 */
/* -------------------------------------------------------------------------- */

/** Verified reviews whose 12 months have run out, oldest first. */
export async function expiringRequestIds(db: DbExecutor, now: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: vr.id })
    .from(vr)
    .where(and(eq(vr.status, "verified"), lte(vr.reviewExpiresAt, now)))
    .orderBy(asc(vr.reviewExpiresAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

export interface RereviewCandidate {
  requestId: string;
  listerUserId: string;
  reviewExpiresAt: Date;
}

/**
 * Verified reviews ending within the re-review window whose lister has no open request (a
 * re-review already under way needs no nudge) and whose current window's reminder isn't finished
 * on both channels.
 */
export async function rereviewReminderCandidates(db: DbExecutor, now: Date, limit: number): Promise<RereviewCandidate[]> {
  const until = new Date(now.getTime() + REREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const windowReminder = sql`case when ${vr.reviewExpiresAt} <= ${sevenDays.toISOString()}::timestamptz then '7d' else '30d' end`;
  const finishedChannels = sql<number>`(
    select count(*)::int from ${rem}
    where ${rem.requestId} = ${vr.id}
      and ${rem.reminder} = ${windowReminder}
      and (${rem.status} <> 'failed' or ${rem.attempts} >= ${REMINDER_MAX_ATTEMPTS})
  )`;
  const openRequest = sql`exists (
    select 1 from ${verificationRequests} "open_vr"
    where "open_vr"."lister_user_id" = ${vr.listerUserId}
      and "open_vr"."status" in (${sql.join(
        OPEN_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )})
  )`;
  const rows = await db
    .select({ requestId: vr.id, listerUserId: vr.listerUserId, reviewExpiresAt: vr.reviewExpiresAt })
    .from(vr)
    .where(
      and(
        eq(vr.status, "verified"),
        gt(vr.reviewExpiresAt, now),
        lte(vr.reviewExpiresAt, until),
        sql`not ${openRequest}`,
        sql`${finishedChannels} < 2`,
      ),
    )
    .orderBy(asc(vr.reviewExpiresAt))
    .limit(limit);
  return rows.filter((r): r is RereviewCandidate => r.reviewExpiresAt !== null);
}

/**
 * Closed requests that still hold documents and whose retention clock has run out. Mirrors
 * `purgeDueAt` (lib/verification/retention.ts); the job re-checks each row with it under a lock.
 */
export async function purgeCandidateIds(db: DbExecutor, now: Date, limit: number): Promise<string[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const due = sql`(
    (${vr.status} = 'expired' and ${vr.endedAt} + make_interval(days => ${RETENTION_DAYS_AFTER_END}::int) <= ${at})
    or (${vr.status} = 'rejected' and ${vr.decidedAt} + make_interval(days => ${RETENTION_DAYS_AFTER_REJECTION}::int) <= ${at})
    or (${vr.status} = 'suspended' and ${vr.decidedAt} + make_interval(months => ${RETENTION_MONTHS_AFTER_SUSPENSION}::int) <= ${at})
  )`;
  const rows = await db
    .select({ id: vr.id })
    .from(vr)
    .where(
      and(
        inArray(vr.status, ["expired", "rejected", "suspended"]),
        isNull(vr.documentsPurgedAt),
        sql`exists (select 1 from ${vd} where ${vd.requestId} = ${vr.id})`,
        due,
      ),
    )
    .orderBy(asc(vr.updatedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every other `verified` request of this lister, locked: approval replaces them (S13 decision 5).
 */
export async function lockOtherVerifiedRequests(tx: DbExecutor, listerUserId: string, keepId: string): Promise<VerificationRequest[]> {
  return tx
    .select()
    .from(vr)
    .where(and(eq(vr.listerUserId, listerUserId), eq(vr.status, "verified"), ne(vr.id, keepId)))
    .for("update");
}

/** Deletes all of a request's document rows; returns their storage keys for the object delete. */
export async function deleteRequestDocuments(tx: DbExecutor, requestId: string): Promise<string[]> {
  const rows = await tx.delete(vd).where(eq(vd.requestId, requestId)).returning({ key: vd.storageKey });
  return rows.map((r) => r.key);
}

/* -------------------------------------------------------------------------- */
/* Reminder bookkeeping (same rules as billing_reminders, prompt S9 decision 8) */
/* -------------------------------------------------------------------------- */

export type VerificationReminderKind = "30d" | "7d" | "expired";
export type VerificationReminderChannel = "email" | "sms";
export type VerificationReminderStatus = "sent" | "failed" | "skipped";

export interface VerificationReminderKey {
  requestId: string;
  reminder: VerificationReminderKind;
  channel: VerificationReminderChannel;
}

function keyCondition(key: VerificationReminderKey) {
  return and(eq(rem.requestId, key.requestId), eq(rem.reminder, key.reminder), eq(rem.channel, key.channel));
}

/** True when this caller now owns the send: a new row, or a failed one with attempts left. */
export async function claimVerificationReminder(db: DbExecutor, key: VerificationReminderKey): Promise<boolean> {
  const inserted = await db
    .insert(rem)
    .values({ ...key, status: "pending" })
    .onConflictDoNothing({ target: [rem.requestId, rem.reminder, rem.channel] })
    .returning({ id: rem.id });
  if (inserted.length > 0) return true;
  const reclaimed = await db
    .update(rem)
    .set({ status: "pending", attempts: sql`${rem.attempts} + 1`, lastError: null })
    .where(and(keyCondition(key), eq(rem.status, "failed"), lt(rem.attempts, REMINDER_MAX_ATTEMPTS)))
    .returning({ id: rem.id });
  return reclaimed.length > 0;
}

export async function finishVerificationReminder(
  db: DbExecutor,
  key: VerificationReminderKey,
  { status, error, now }: { status: VerificationReminderStatus; error?: string; now: Date },
): Promise<void> {
  await db
    .update(rem)
    .set({ status, lastError: error ? error.slice(0, 100) : null, sentAt: status === "sent" ? now : null })
    .where(and(keyCondition(key), eq(rem.status, "pending")));
}

export interface LifecycleRecipient {
  email: string;
  name: string;
  /** E.164 from the lister profile, when set. */
  phone: string | null;
}

export async function lifecycleRecipient(db: DbExecutor, listerUserId: string): Promise<LifecycleRecipient | null> {
  const [row] = await db
    .select({ email: users.email, name: users.name, phone: listerProfiles.phone })
    .from(users)
    .leftJoin(listerProfiles, eq(listerProfiles.userId, users.id))
    .where(eq(users.id, listerUserId))
    .limit(1);
  return row ?? null;
}
