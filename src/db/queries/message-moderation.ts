import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "@/db/executor";
import { conversations, listerProfiles, messageModerationLog, messageReports, messages, properties, userBlocks, users } from "@/db/schema";
import type { MessageReportInput } from "@/lib/validation/messaging";
import { participant } from "./messaging";
import { OPEN_REPORT_STATUSES } from "./reports";

/**
 * Message reports and moderator access (prompt S15 decisions 12 and 13). Recipients report a
 * message; platform admins (checked by callers) read a reported conversation only through its
 * report, and every view and decision is written to the append-only `message_moderation_log`.
 */

const c = conversations;
const m = messages;
const r = messageReports;
const log = messageModerationLog;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A resolved report still opens its conversation for this long (follow-ups, appeals). */
export const RESOLVED_ACCESS_DAYS = 30;
const EXCERPT_LENGTH = 140;

export type MessageLogAction = "view_conversation" | "dismiss_report" | "remove_message" | "close_conversation";

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export type MessageReportResult = { ok: true } | { ok: false; reason: "not_found" | "already_reported" };

/**
 * Only the recipient can report: the message must be from the other participant of a
 * conversation the reporter is in. With `block`, the sender is blocked in the same transaction.
 */
export async function reportMessage(
  tx: DbExecutor,
  reporterId: string,
  messageId: string,
  input: MessageReportInput,
  now = new Date(),
): Promise<MessageReportResult> {
  if (!UUID.test(messageId)) return { ok: false, reason: "not_found" };
  const [message] = await tx
    .select({ conversationId: m.conversationId, senderUserId: m.senderUserId })
    .from(m)
    .innerJoin(c, eq(c.id, m.conversationId))
    .where(and(eq(m.id, messageId), participant(reporterId), sql`${m.senderUserId} <> ${reporterId}`, isNull(m.removedAt)))
    .limit(1);
  if (!message) return { ok: false, reason: "not_found" };

  const inserted = await tx
    .insert(r)
    .values({ messageId, conversationId: message.conversationId, reporterUserId: reporterId, reason: input.reason, details: input.details })
    .onConflictDoNothing()
    .returning({ id: r.id });
  if (inserted.length === 0) return { ok: false, reason: "already_reported" };

  await tx.update(m).set({ reportedAt: now }).where(and(eq(m.id, messageId), isNull(m.reportedAt)));
  if (input.block) {
    await tx.insert(userBlocks).values({ blockerUserId: reporterId, blockedUserId: message.senderUserId }).onConflictDoNothing();
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Admin queue                                                                */
/* -------------------------------------------------------------------------- */

const reporter = alias(users, "reporter");

export async function openMessageReportCount(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(r)
    .where(inArray(r.status, [...OPEN_REPORT_STATUSES]));
  return row?.n ?? 0;
}

/** Open message reports, newest first, with a short excerpt of the reported message only. */
export async function listOpenMessageReports(db: DbExecutor) {
  return db
    .select({
      id: r.id,
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt,
      reporterName: reporter.name,
      excerpt: sql<string>`left(${m.body}, ${EXCERPT_LENGTH})`,
      messageLength: sql<number>`char_length(${m.body})`,
    })
    .from(r)
    .innerJoin(m, eq(m.id, r.messageId))
    .leftJoin(reporter, eq(reporter.id, r.reporterUserId))
    .where(inArray(r.status, [...OPEN_REPORT_STATUSES]))
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(200);
}

export type OpenMessageReport = Awaited<ReturnType<typeof listOpenMessageReports>>[number];

async function writeLog(
  tx: DbExecutor,
  entry: { actorUserId: string; action: MessageLogAction; conversationId: string; messageId?: string; reportId?: string; reason?: string },
): Promise<void> {
  await tx.insert(log).values(entry);
}

const buyerUser = alias(users, "buyer_user");
const listerUser = alias(users, "lister_user");

/**
 * The reported conversation for a moderator, through an open report or one resolved in the last
 * `RESOLVED_ACCESS_DAYS`. Removed messages keep their text here (evidence). Writes a
 * `view_conversation` log row, so callers must only call it for a real page view.
 */
export async function getReportedThread(tx: DbExecutor, adminId: string, reportId: string, now = new Date()) {
  if (!UUID.test(reportId)) return null;
  const since = new Date(now.getTime() - RESOLVED_ACCESS_DAYS * 24 * 60 * 60 * 1000);
  const [report] = await tx
    .select({
      id: r.id,
      status: r.status,
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt,
      messageId: r.messageId,
      conversationId: r.conversationId,
      reporterName: reporter.name,
    })
    .from(r)
    .leftJoin(reporter, eq(reporter.id, r.reporterUserId))
    .where(and(eq(r.id, reportId), or(inArray(r.status, [...OPEN_REPORT_STATUSES]), gte(r.resolvedAt, since))))
    .limit(1);
  if (!report) return null;

  const [conversation] = await tx
    .select({
      id: c.id,
      closedAt: c.closedAt,
      buyerUserId: c.buyerUserId,
      buyerName: buyerUser.name,
      listerUserId: c.listerUserId,
      listerName: sql<string>`coalesce(${listerProfiles.displayName}, ${listerUser.name})`,
      propertyId: properties.id,
      propertyTitle: properties.title,
      propertySlug: properties.slug,
      propertyStatus: properties.status,
    })
    .from(c)
    .innerJoin(properties, eq(properties.id, c.propertyId))
    .innerJoin(buyerUser, eq(buyerUser.id, c.buyerUserId))
    .innerJoin(listerUser, eq(listerUser.id, c.listerUserId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, c.listerUserId))
    .where(eq(c.id, report.conversationId))
    .limit(1);
  if (!conversation) return null;

  const thread = await tx
    .select({ id: m.id, senderUserId: m.senderUserId, body: m.body, createdAt: m.createdAt, removedAt: m.removedAt })
    .from(m)
    .where(eq(m.conversationId, conversation.id))
    .orderBy(asc(m.createdAt), asc(m.id))
    .limit(500);

  await writeLog(tx, { actorUserId: adminId, action: "view_conversation", conversationId: conversation.id, reportId: report.id });
  return { report, conversation, messages: thread };
}

export type ReportedThread = NonNullable<Awaited<ReturnType<typeof getReportedThread>>>;

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

export type MessageDecisionResult = { ok: true } | { ok: false; reason: "not_found" | "conflict" };

async function lockReport(tx: DbExecutor, reportId: string) {
  if (!UUID.test(reportId)) return null;
  const [row] = await tx
    .select({ status: r.status, messageId: r.messageId, conversationId: r.conversationId })
    .from(r)
    .where(eq(r.id, reportId))
    .limit(1)
    .for("update");
  return row ?? null;
}

const isOpen = (status: string) => (OPEN_REPORT_STATUSES as readonly string[]).includes(status);

/** Resolves (or dismisses) every open report on the message. */
async function closeReportsOn(tx: DbExecutor, messageId: string, status: "resolved" | "dismissed", adminId: string, now: Date) {
  await tx
    .update(r)
    .set({ status, resolvedBy: adminId, resolvedAt: now })
    .where(and(eq(r.messageId, messageId), inArray(r.status, [...OPEN_REPORT_STATUSES])));
}

export async function dismissMessageReport(tx: DbExecutor, adminId: string, reportId: string, now = new Date()): Promise<MessageDecisionResult> {
  const report = await lockReport(tx, reportId);
  if (!report) return { ok: false, reason: "not_found" };
  if (!isOpen(report.status)) return { ok: false, reason: "conflict" };
  await closeReportsOn(tx, report.messageId, "dismissed", adminId, now);
  await writeLog(tx, { actorUserId: adminId, action: "dismiss_report", conversationId: report.conversationId, messageId: report.messageId, reportId });
  return { ok: true };
}

/**
 * Removes the reported message (its text is kept for evidence but never shown to participants)
 * and, with `close`, closes the conversation so nobody can send any more.
 */
export async function removeReportedMessage(
  tx: DbExecutor,
  adminId: string,
  reportId: string,
  reason: string,
  close: boolean,
  now = new Date(),
): Promise<MessageDecisionResult> {
  const report = await lockReport(tx, reportId);
  if (!report) return { ok: false, reason: "not_found" };
  if (!isOpen(report.status)) return { ok: false, reason: "conflict" };

  await tx.update(m).set({ removedAt: now, removedBy: adminId }).where(and(eq(m.id, report.messageId), isNull(m.removedAt)));
  await closeReportsOn(tx, report.messageId, "resolved", adminId, now);
  const base = { actorUserId: adminId, conversationId: report.conversationId, messageId: report.messageId, reportId, reason };
  await writeLog(tx, { ...base, action: "remove_message" });
  if (close) {
    await tx.update(c).set({ closedAt: now, closedBy: adminId }).where(and(eq(c.id, report.conversationId), isNull(c.closedAt)));
    await writeLog(tx, { ...base, action: "close_conversation" });
  }
  return { ok: true };
}

/** For the admin thread page: the log for this conversation, newest first. */
export async function conversationModerationHistory(db: DbExecutor, conversationId: string) {
  return db
    .select({ id: log.id, action: log.action, reason: log.reason, createdAt: log.createdAt, actorName: users.name })
    .from(log)
    .leftJoin(users, eq(users.id, log.actorUserId))
    .where(eq(log.conversationId, conversationId))
    .orderBy(desc(log.createdAt), desc(log.id))
    .limit(50);
}
