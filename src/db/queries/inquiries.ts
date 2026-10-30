import "server-only";
import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { inquiries, listerProfiles, properties } from "@/db/schema";
import type { ListerContact } from "@/lib/listings/contact";
import type { InquiryInput } from "@/lib/validation/engagement";
import { manageableBy } from "./listings";

/**
 * Inquiries (prompt S8 decisions 1, 2 and 11). The recipient always comes from the property row.
 * Listers read inquiries for listings they can manage (`manageableBy`), never by id alone.
 */

const p = properties;
const i = inquiries;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most this many inquiries per sender per listing in 24 hours. */
export const MAX_INQUIRIES_PER_LISTING_PER_DAY = 3;
export const INBOX_LIMIT = 200;

export type InquiryResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "own_listing" | "too_many" | "duplicate" };

/**
 * Must run in a transaction: an advisory lock per sender and listing serialises the 24-hour count,
 * so parallel sends cannot slip past the cap.
 */
export async function createInquiry(
  tx: DbExecutor,
  senderId: string,
  propertyId: string,
  input: InquiryInput,
  now = new Date(),
): Promise<InquiryResult> {
  if (!UUID.test(propertyId)) return { ok: false, reason: "unavailable" };
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inquiry:${senderId}:${propertyId}`}))`);

  const [property] = await tx
    .select({ ownerUserId: p.ownerUserId, mine: sql<boolean>`${manageableBy(senderId)}` })
    .from(p)
    .where(and(eq(p.id, propertyId), eq(p.status, "published")))
    .limit(1);
  if (!property) return { ok: false, reason: "unavailable" };
  if (property.mine) return { ok: false, reason: "own_listing" };

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recent = await tx
    .select({ message: i.message })
    .from(i)
    .where(and(eq(i.senderUserId, senderId), eq(i.propertyId, propertyId), gte(i.createdAt, since)));
  if (recent.some((row) => row.message === input.message)) return { ok: false, reason: "duplicate" };
  if (recent.length >= MAX_INQUIRIES_PER_LISTING_PER_DAY) return { ok: false, reason: "too_many" };

  await tx.insert(i).values({
    propertyId,
    senderUserId: senderId,
    recipientUserId: property.ownerUserId,
    fullName: input.fullName,
    phone: input.phone,
    email: input.email,
    message: input.message,
  });
  return { ok: true };
}

export async function hasInquired(db: DbExecutor, userId: string, propertyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: i.id })
    .from(i)
    .where(and(eq(i.senderUserId, userId), eq(i.propertyId, propertyId)))
    .limit(1);
  return Boolean(row);
}

/**
 * The listing owner's phone and public email. Callers apply the contact rule
 * (`src/lib/listings/contact.ts`) before anything reaches the page.
 */
export async function getListerContact(db: DbExecutor, ownerUserId: string): Promise<ListerContact> {
  const [row] = await db
    .select({ phone: listerProfiles.phone, email: listerProfiles.publicEmail })
    .from(listerProfiles)
    .where(eq(listerProfiles.userId, ownerUserId))
    .limit(1);
  return row ?? { phone: null, email: null };
}

/** Inquiries about listings the user can manage, newest first. */
export async function listReceived(db: DbExecutor, userId: string) {
  return db
    .select({
      id: i.id,
      fullName: i.fullName,
      phone: i.phone,
      email: i.email,
      message: i.message,
      readAt: i.readAt,
      createdAt: i.createdAt,
      propertyTitle: p.title,
      propertySlug: p.slug,
      propertyStatus: p.status,
    })
    .from(i)
    .innerJoin(p, eq(p.id, i.propertyId))
    .where(manageableBy(userId))
    .orderBy(desc(i.createdAt), desc(i.id))
    .limit(INBOX_LIMIT);
}

export type ReceivedInquiry = Awaited<ReturnType<typeof listReceived>>[number];

export async function unreadCount(db: DbExecutor, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(i)
    .innerJoin(p, eq(p.id, i.propertyId))
    .where(and(manageableBy(userId), isNull(i.readAt)));
  return row?.n ?? 0;
}

/** Marks one inquiry (or all of them) read, only within listings the user can manage. */
export async function markRead(db: DbExecutor, userId: string, inquiryId?: string, now = new Date()): Promise<number> {
  if (inquiryId !== undefined && !UUID.test(inquiryId)) return 0;
  const updated = await db
    .update(i)
    .set({ readAt: now })
    .where(
      and(
        isNull(i.readAt),
        sql`${i.propertyId} in (select ${p.id} from ${p} where ${manageableBy(userId)})`,
        inquiryId ? eq(i.id, inquiryId) : undefined,
      ),
    )
    .returning({ id: i.id });
  return updated.length;
}
