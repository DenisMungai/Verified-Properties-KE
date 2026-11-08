import "server-only";
import { and, asc, eq, gte, isNull, lte, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "@/db/executor";
import { conversations as c, messages as m, notificationDeliveries as nd, properties as p, userBlocks, users } from "@/db/schema";

/**
 * New-message alert reads (prompt S16 decision 2). An unread streak is a sender's unread,
 * not-removed messages in one conversation; its first message (within the 24-hour window) is the
 * dedupe key. Everything else the sender needs (skip reasons, unread count, title) comes back too.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MessageAlert {
  conversationId: string;
  /** The streak's first unread message: the delivery ref. */
  messageId: string;
  recipientUserId: string;
  recipientEmail: string;
  recipientName: string;
  emailVerified: boolean;
  listingTitle: string;
  unreadCount: number;
  closed: boolean;
  blocked: boolean;
  /** The first message has since been read or removed (retries only). */
  read: boolean;
}

/** Unread, visible messages from `sender` in `conversation`, counted at send time. */
function unreadCount(conversationId: SQLWrapper, senderUserId: SQLWrapper) {
  const mm = alias(m, "mm");
  return sql<number>`(select count(*)::int from ${m} as ${sql.identifier("mm")} where ${mm.conversationId} = ${conversationId} and ${mm.senderUserId} = ${senderUserId} and ${mm.readAt} is null and ${mm.removedAt} is null)`;
}

/** Either person has blocked the other. */
function blockedBetween(a: SQLWrapper, b: SQLWrapper) {
  const ub = alias(userBlocks, "ub");
  return sql<boolean>`exists (select 1 from ${userBlocks} as ${sql.identifier("ub")} where (${ub.blockerUserId} = ${a} and ${ub.blockedUserId} = ${b}) or (${ub.blockerUserId} = ${b} and ${ub.blockedUserId} = ${a}))`;
}

/** The participant who didn't send. */
function otherThan(senderUserId: SQLWrapper) {
  return sql<string>`case when ${senderUserId} = ${c.buyerUserId} then ${c.listerUserId} else ${c.buyerUserId} end`;
}

/**
 * Streaks whose first message (within the window) is between `window.from` and `window.dueBefore`
 * and that have no delivery row yet, oldest first.
 */
export async function dueMessageAlerts(
  db: DbExecutor,
  window: { from: Date; dueBefore: Date },
  limit: number,
): Promise<MessageAlert[]> {
  const first = db
    .selectDistinctOn([m.conversationId, m.senderUserId], {
      conversationId: m.conversationId,
      senderUserId: m.senderUserId,
      messageId: m.id,
      firstAt: m.createdAt,
    })
    .from(m)
    .where(and(isNull(m.readAt), isNull(m.removedAt), gte(m.createdAt, window.from)))
    .orderBy(m.conversationId, m.senderUserId, asc(m.createdAt), asc(m.id))
    .as("first_unread");

  const rows = await db
    .select({
      conversationId: first.conversationId,
      messageId: first.messageId,
      recipientUserId: users.id,
      recipientEmail: users.email,
      recipientName: users.name,
      emailVerified: users.emailVerified,
      listingTitle: p.title,
      unreadCount: unreadCount(first.conversationId, first.senderUserId),
      closed: sql<boolean>`${c.closedAt} is not null`,
      blocked: blockedBetween(first.senderUserId, users.id),
    })
    .from(first)
    .innerJoin(c, eq(c.id, first.conversationId))
    .innerJoin(users, eq(users.id, otherThan(first.senderUserId)))
    .innerJoin(p, eq(p.id, c.propertyId))
    .where(
      and(
        lte(first.firstAt, window.dueBefore),
        sql`not exists (select 1 from ${nd} where ${nd.kind} = 'message_alert' and ${nd.ref} = ${first.messageId}::text and ${nd.recipientUserId} = ${users.id})`,
      ),
    )
    .orderBy(asc(first.firstAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, read: false }));
}

/** The current state of one streak, for a retry. Null when the message or recipient is gone. */
export async function messageAlertState(db: DbExecutor, messageId: string, recipientUserId: string): Promise<MessageAlert | null> {
  if (!UUID.test(messageId)) return null;
  const [row] = await db
    .select({
      conversationId: m.conversationId,
      messageId: m.id,
      recipientUserId: users.id,
      recipientEmail: users.email,
      recipientName: users.name,
      emailVerified: users.emailVerified,
      listingTitle: p.title,
      unreadCount: unreadCount(m.conversationId, m.senderUserId),
      closed: sql<boolean>`${c.closedAt} is not null`,
      blocked: blockedBetween(m.senderUserId, users.id),
      read: sql<boolean>`(${m.readAt} is not null or ${m.removedAt} is not null)`,
    })
    .from(m)
    .innerJoin(c, eq(c.id, m.conversationId))
    .innerJoin(users, eq(users.id, otherThan(m.senderUserId)))
    .innerJoin(p, eq(p.id, c.propertyId))
    .where(and(eq(m.id, messageId), eq(users.id, recipientUserId)))
    .limit(1);
  return row ?? null;
}
