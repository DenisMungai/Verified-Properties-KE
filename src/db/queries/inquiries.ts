import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, inquiries, listerProfiles, properties } from "@/db/schema";
import { NO_CONTACT, type ListerContact } from "@/lib/listings/contact";
import type { InquiryInput } from "@/lib/validation/engagement";
import { manageableBy } from "./listings";
import { appendMessage, isBlockedBetween, startOrReuseConversation } from "./messaging";

/**
 * Inquiries (prompt S8 decisions 1 and 2). The recipient always comes from the property row.
 * Since S15 each inquiry also starts (or continues) the in-app conversation with the listing
 * owner, where the lister reads and replies (prompt S15 decisions 1 and 6).
 */

const p = properties;
const i = inquiries;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most this many inquiries per sender per listing in 24 hours. */
export const MAX_INQUIRIES_PER_LISTING_PER_DAY = 3;

export type InquiryResult =
  | { ok: true; conversationId: string }
  | { ok: false; reason: "unavailable" | "own_listing" | "too_many" | "duplicate" | "blocked" | "closed" };

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
  if (await isBlockedBetween(tx, senderId, property.ownerUserId)) return { ok: false, reason: "blocked" };

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recent = await tx
    .select({ message: i.message })
    .from(i)
    .where(and(eq(i.senderUserId, senderId), eq(i.propertyId, propertyId), gte(i.createdAt, since)));
  if (recent.some((row) => row.message === input.message)) return { ok: false, reason: "duplicate" };
  if (recent.length >= MAX_INQUIRIES_PER_LISTING_PER_DAY) return { ok: false, reason: "too_many" };

  // A moderator closed this conversation (so it already existed): nothing new is recorded.
  const conversation = await startOrReuseConversation(tx, senderId, propertyId, property.ownerUserId);
  if (conversation.closed) return { ok: false, reason: "closed" };

  await tx.insert(i).values({
    propertyId,
    senderUserId: senderId,
    recipientUserId: property.ownerUserId,
    fullName: input.fullName,
    phone: input.phone,
    email: input.email,
    message: input.message,
    // The same instant as its message, so the two rows stay matched (and the 0009 backfill
    // recognises it as already copied).
    createdAt: now,
  });
  await appendMessage(tx, conversation.id, senderId, input.message, now);
  return { ok: true, conversationId: conversation.id };
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
 * A listing's contacts: the owner's phone, WhatsApp and public email, and, when the listing is an
 * agency listing, the agency's name and office contacts. Callers apply the contact rule
 * (`src/lib/listings/contact.ts`) before anything reaches the page.
 */
export async function getListingContact(db: DbExecutor, propertyId: string): Promise<ListerContact> {
  if (!UUID.test(propertyId)) return NO_CONTACT;
  const [row] = await db
    .select({
      phone: listerProfiles.phone,
      whatsapp: listerProfiles.whatsapp,
      email: listerProfiles.publicEmail,
      agencyName: agencies.name,
      agencyPhone: agencies.publicPhone,
      agencyWhatsapp: agencies.whatsapp,
      agencyEmail: agencies.publicEmail,
    })
    .from(p)
    .leftJoin(listerProfiles, eq(listerProfiles.userId, p.ownerUserId))
    .leftJoin(agencies, eq(agencies.id, p.agencyId))
    .where(eq(p.id, propertyId))
    .limit(1);
  if (!row) return NO_CONTACT;
  return {
    lister: { phone: row.phone, whatsapp: row.whatsapp, email: row.email },
    agency:
      row.agencyName === null
        ? null
        : { name: row.agencyName, phone: row.agencyPhone, whatsapp: row.agencyWhatsapp, email: row.agencyEmail },
  };
}
