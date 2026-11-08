import "server-only";
import { and, asc, desc, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "@/db/executor";
import { conversations, inquiries, listerProfiles, messageReports, messages, properties, propertyImages, userBlocks, users } from "@/db/schema";
import { DUPLICATE_WINDOW_MS } from "@/lib/validation/messaging";

/**
 * In-app messaging (prompt S15 decisions 2, 9–11). Every read and write is scoped to the
 * conversation's two participants in SQL (`participant`), so an id that isn't yours behaves
 * exactly like one that doesn't exist. Only the buyer and the listing owner are participants.
 */

const c = conversations;
const m = messages;
const p = properties;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CONVERSATION_LIMIT = 100;
export const THREAD_LIMIT = 200;
const EXCERPT_LENGTH = 120;

/** The conversation row belongs to this user (as buyer or lister). */
export function participant(userId: string): SQL {
  return sql`(${c.buyerUserId} = ${userId} or ${c.listerUserId} = ${userId})`;
}

export type ConversationRole = "buyer" | "lister";

/* -------------------------------------------------------------------------- */
/* Starting and sending                                                       */
/* -------------------------------------------------------------------------- */

/** Either person has blocked the other. */
export async function isBlockedBetween(db: DbExecutor, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerUserId, a), eq(userBlocks.blockedUserId, b)),
        and(eq(userBlocks.blockerUserId, b), eq(userBlocks.blockedUserId, a)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The conversation for this listing, buyer and lister, created on first use. The caller has
 * already checked the listing is published and not the buyer's own; `listerId` comes from the
 * property row, never from input.
 */
export async function startOrReuseConversation(
  tx: DbExecutor,
  buyerId: string,
  propertyId: string,
  listerId: string,
): Promise<{ id: string; closed: boolean }> {
  await tx
    .insert(c)
    .values({ propertyId, buyerUserId: buyerId, listerUserId: listerId })
    .onConflictDoNothing({ target: [c.propertyId, c.buyerUserId, c.listerUserId] });
  const [row] = await tx
    .select({ id: c.id, closedAt: c.closedAt })
    .from(c)
    .where(and(eq(c.propertyId, propertyId), eq(c.buyerUserId, buyerId), eq(c.listerUserId, listerId)))
    .limit(1);
  if (!row) throw new Error("conversation upsert returned nothing");
  return { id: row.id, closed: row.closedAt !== null };
}

/** Inserts a message and moves the conversation to the top of both inboxes. */
export async function appendMessage(tx: DbExecutor, conversationId: string, senderId: string, body: string, now: Date): Promise<string> {
  const [row] = await tx
    .insert(m)
    .values({ conversationId, senderUserId: senderId, body, createdAt: now })
    .returning({ id: m.id });
  await tx.update(c).set({ lastMessageAt: now }).where(eq(c.id, conversationId));
  return row!.id;
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "not_found" | "closed" | "blocked" | "duplicate" };

/**
 * Must run in a transaction: an advisory lock per conversation serialises sends, so the
 * duplicate guard can't be raced by a double click.
 */
export async function sendMessage(
  tx: DbExecutor,
  userId: string,
  conversationId: string,
  body: string,
  now = new Date(),
): Promise<SendResult> {
  if (!UUID.test(conversationId)) return { ok: false, reason: "not_found" };
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`conversation:${conversationId}`}))`);

  const [conversation] = await tx
    .select({ buyerUserId: c.buyerUserId, listerUserId: c.listerUserId, closedAt: c.closedAt })
    .from(c)
    .where(and(eq(c.id, conversationId), participant(userId)))
    .limit(1);
  if (!conversation) return { ok: false, reason: "not_found" };
  if (conversation.closedAt) return { ok: false, reason: "closed" };
  const other = conversation.buyerUserId === userId ? conversation.listerUserId : conversation.buyerUserId;
  if (await isBlockedBetween(tx, userId, other)) return { ok: false, reason: "blocked" };

  const [last] = await tx
    .select({ body: m.body, createdAt: m.createdAt })
    .from(m)
    .where(and(eq(m.conversationId, conversationId), eq(m.senderUserId, userId)))
    .orderBy(desc(m.createdAt))
    .limit(1);
  if (last && last.body === body && now.getTime() - last.createdAt.getTime() < DUPLICATE_WINDOW_MS) {
    return { ok: false, reason: "duplicate" };
  }

  return { ok: true, messageId: await appendMessage(tx, conversationId, userId, body, now) };
}

/** The signed-in buyer's conversation about this listing, if any. */
export async function conversationForListing(db: DbExecutor, buyerId: string, propertyId: string): Promise<string | null> {
  if (!UUID.test(propertyId)) return null;
  const [row] = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.propertyId, propertyId), eq(c.buyerUserId, buyerId)))
    .orderBy(desc(c.lastMessageAt))
    .limit(1);
  return row?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Inbox                                                                      */
/* -------------------------------------------------------------------------- */

const buyerUser = alias(users, "buyer_user");
const listerUser = alias(users, "lister_user");

/** Unread messages sent by the other person, in conversations this user is in. */
function unreadIn(userId: string, conversationId: SQL | typeof c.id): SQL<number> {
  return sql<number>`(select count(*)::int from ${m}
    where ${m.conversationId} = ${conversationId} and ${m.senderUserId} <> ${userId}
      and ${m.readAt} is null and ${m.removedAt} is null)`;
}

function roleOf(userId: string): SQL<ConversationRole> {
  return sql<ConversationRole>`case when ${c.buyerUserId} = ${userId} then 'buyer' else 'lister' end`;
}

/** The other person's display name: the lister's public name, or the buyer's account name. */
function otherNameOf(userId: string): SQL<string> {
  return sql<string>`case when ${c.buyerUserId} = ${userId}
    then coalesce(${listerProfiles.displayName}, ${listerUser.name}) else ${buyerUser.name} end`;
}

function otherAvatarOf(userId: string): SQL<string | null> {
  return sql<string | null>`case when ${c.buyerUserId} = ${userId} then ${listerProfiles.avatarKey} else null end`;
}

const coverKey = sql<string | null>`(select ${propertyImages.storageKey} from ${propertyImages}
  where ${propertyImages.propertyId} = ${p.id} and ${propertyImages.isCover} limit 1)`;

function lastMessage<T>(column: SQL): SQL<T> {
  return sql<T>`(select ${column} from ${m} where ${m.conversationId} = ${c.id}
    order by ${m.createdAt} desc, ${m.id} desc limit 1)`;
}

export async function listConversations(db: DbExecutor, userId: string) {
  const rows = await db
    .select({
      id: c.id,
      role: roleOf(userId),
      otherName: otherNameOf(userId),
      otherAvatarKey: otherAvatarOf(userId),
      propertyTitle: p.title,
      propertySlug: p.slug,
      propertyStatus: p.status,
      coverKey,
      lastExcerpt: lastMessage<string | null>(
        sql`case when ${m.removedAt} is null then left(${m.body}, ${EXCERPT_LENGTH}) end`,
      ),
      lastFromMe: lastMessage<boolean | null>(sql`${m.senderUserId} = ${userId}`),
      lastMessageAt: c.lastMessageAt,
      unread: unreadIn(userId, c.id),
      closed: sql<boolean>`${c.closedAt} is not null`,
    })
    .from(c)
    .innerJoin(p, eq(p.id, c.propertyId))
    .innerJoin(buyerUser, eq(buyerUser.id, c.buyerUserId))
    .innerJoin(listerUser, eq(listerUser.id, c.listerUserId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, c.listerUserId))
    .where(participant(userId))
    .orderBy(desc(c.lastMessageAt), desc(c.id))
    .limit(CONVERSATION_LIMIT);
  return rows;
}

export type ConversationSummary = Awaited<ReturnType<typeof listConversations>>[number];

export async function unreadTotal(db: DbExecutor, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .innerJoin(c, eq(c.id, m.conversationId))
    .where(and(participant(userId), ne(m.senderUserId, userId), isNull(m.readAt), isNull(m.removedAt)));
  return row?.n ?? 0;
}

/** For polling: the user's unread total and, if they're in it, one conversation's last activity. */
export async function messageStatus(
  db: DbExecutor,
  userId: string,
  conversationId: string | null,
): Promise<{ unread: number; lastMessageAt?: string }> {
  const [unread, conversation] = await Promise.all([
    unreadTotal(db, userId),
    conversationId && UUID.test(conversationId)
      ? db
          .select({ lastMessageAt: c.lastMessageAt })
          .from(c)
          .where(and(eq(c.id, conversationId), participant(userId)))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const lastMessageAt = conversation[0]?.lastMessageAt;
  return lastMessageAt ? { unread, lastMessageAt: lastMessageAt.toISOString() } : { unread };
}

/* -------------------------------------------------------------------------- */
/* Thread                                                                     */
/* -------------------------------------------------------------------------- */

const messageIdColumn = sql`${sql.identifier("messages")}.${sql.identifier("id")}`;

export interface ThreadMessage {
  id: string;
  mine: boolean;
  /** Null when a moderator removed it. */
  body: string | null;
  createdAt: Date;
  /** This user has an open report on it. */
  reportedByMe: boolean;
}

export async function getThread(db: DbExecutor, userId: string, conversationId: string) {
  if (!UUID.test(conversationId)) return null;
  const [header] = await db
    .select({
      id: c.id,
      role: roleOf(userId),
      propertyId: p.id,
      buyerUserId: c.buyerUserId,
      listerUserId: c.listerUserId,
      otherName: otherNameOf(userId),
      otherAvatarKey: otherAvatarOf(userId),
      listerVerified: sql<boolean>`lister_verified_now(${c.listerUserId})`,
      propertyTitle: p.title,
      propertySlug: p.slug,
      propertyStatus: p.status,
      closed: sql<boolean>`${c.closedAt} is not null`,
      blockedByMe: sql<boolean>`exists (select 1 from ${userBlocks} where ${userBlocks.blockerUserId} = ${userId}
        and ${userBlocks.blockedUserId} = case when ${c.buyerUserId} = ${userId} then ${c.listerUserId} else ${c.buyerUserId} end)`,
      blockedByOther: sql<boolean>`exists (select 1 from ${userBlocks} where ${userBlocks.blockedUserId} = ${userId}
        and ${userBlocks.blockerUserId} = case when ${c.buyerUserId} = ${userId} then ${c.listerUserId} else ${c.buyerUserId} end)`,
    })
    .from(c)
    .innerJoin(p, eq(p.id, c.propertyId))
    .innerJoin(buyerUser, eq(buyerUser.id, c.buyerUserId))
    .innerJoin(listerUser, eq(listerUser.id, c.listerUserId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, c.listerUserId))
    .where(and(eq(c.id, conversationId), participant(userId)))
    .limit(1);
  if (!header) return null;

  const latest = await db
    .select({
      id: m.id,
      mine: sql<boolean>`${m.senderUserId} = ${userId}`,
      body: sql<string | null>`case when ${m.removedAt} is null then ${m.body} end`,
      createdAt: m.createdAt,
      // Qualified by hand: in a single-table select Drizzle writes `"id"` unqualified, which the
      // subquery would read as message_reports.id.
      reportedByMe: sql<boolean>`exists (select 1 from ${messageReports} where ${messageReports.messageId} = ${messageIdColumn}
        and ${messageReports.reporterUserId} = ${userId} and ${messageReports.status} in ('open', 'reviewing'))`,
    })
    .from(m)
    .where(eq(m.conversationId, header.id))
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(THREAD_LIMIT);

  const thread: ThreadMessage[] = latest.reverse();
  return { ...header, messages: thread };
}

export type Thread = NonNullable<Awaited<ReturnType<typeof getThread>>>;

/** Marks the other person's messages read, only in a conversation this user is in. */
export async function markThreadRead(db: DbExecutor, userId: string, conversationId: string, now = new Date()): Promise<number> {
  if (!UUID.test(conversationId)) return 0;
  const updated = await db
    .update(m)
    .set({ readAt: now })
    .where(
      and(
        eq(m.conversationId, conversationId),
        ne(m.senderUserId, userId),
        isNull(m.readAt),
        sql`${m.conversationId} in (select ${c.id} from ${c} where ${c.id} = ${conversationId} and ${participant(userId)})`,
      ),
    )
    .returning({ id: m.id });
  return updated.length;
}

/** The buyer's most recent contact details for this listing (shown to the lister only). */
export async function buyerContactFor(db: DbExecutor, buyerId: string, propertyId: string) {
  const [row] = await db
    .select({ phone: inquiries.phone, email: inquiries.email })
    .from(inquiries)
    .where(and(eq(inquiries.senderUserId, buyerId), eq(inquiries.propertyId, propertyId)))
    .orderBy(desc(inquiries.createdAt))
    .limit(1);
  return row ?? { phone: null, email: null };
}

/* -------------------------------------------------------------------------- */
/* Blocking                                                                   */
/* -------------------------------------------------------------------------- */

export type BlockResult = { ok: true } | { ok: false; reason: "not_found" };

/** The other participant, derived on the server from a conversation this user is in. */
export async function otherParticipant(db: DbExecutor, userId: string, conversationId: string): Promise<string | null> {
  if (!UUID.test(conversationId)) return null;
  const [row] = await db
    .select({ buyerUserId: c.buyerUserId, listerUserId: c.listerUserId })
    .from(c)
    .where(and(eq(c.id, conversationId), participant(userId)))
    .limit(1);
  if (!row) return null;
  return row.buyerUserId === userId ? row.listerUserId : row.buyerUserId;
}

export async function blockUser(db: DbExecutor, userId: string, conversationId: string): Promise<BlockResult> {
  const other = await otherParticipant(db, userId, conversationId);
  if (!other) return { ok: false, reason: "not_found" };
  await db.insert(userBlocks).values({ blockerUserId: userId, blockedUserId: other }).onConflictDoNothing();
  return { ok: true };
}

export async function unblockUser(db: DbExecutor, userId: string, conversationId: string): Promise<BlockResult> {
  const other = await otherParticipant(db, userId, conversationId);
  if (!other) return { ok: false, reason: "not_found" };
  await db.delete(userBlocks).where(and(eq(userBlocks.blockerUserId, userId), eq(userBlocks.blockedUserId, other)));
  return { ok: true };
}

/** Oldest first; exported for tests. */
export async function messagesIn(db: DbExecutor, conversationId: string) {
  return db.select().from(m).where(eq(m.conversationId, conversationId)).orderBy(asc(m.createdAt), asc(m.id));
}
