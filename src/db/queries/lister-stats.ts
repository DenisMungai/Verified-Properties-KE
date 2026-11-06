import "server-only";
import { and, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { favorites, inquiries, listingViewDays, properties } from "@/db/schema";

/**
 * A lister's own engagement numbers (prompt S13 decision 13). Every query is scoped to listings the
 * user owns (`owner_user_id`), so agency members never see another member's numbers. Aggregates
 * only. Instant windows are [from, to); view windows are Nairobi days (fromDay, toDay].
 */

const count = sql<number>`count(*)::int`;

export async function inquiriesReceived(db: DbExecutor, userId: string, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ n: count })
    .from(inquiries)
    .where(and(eq(inquiries.recipientUserId, userId), gte(inquiries.createdAt, from), lt(inquiries.createdAt, to)));
  return row?.n ?? 0;
}

/** Saves still held (unsaving deletes the row), made in [from, to). */
export async function savesReceived(db: DbExecutor, userId: string, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ n: count })
    .from(favorites)
    .innerJoin(properties, eq(properties.id, favorites.propertyId))
    .where(and(eq(properties.ownerUserId, userId), gte(favorites.createdAt, from), lt(favorites.createdAt, to)));
  return row?.n ?? 0;
}

export async function viewsReceived(db: DbExecutor, userId: string, fromDay: string, toDay: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${listingViewDays.views}), 0)::int` })
    .from(listingViewDays)
    .innerJoin(properties, eq(properties.id, listingViewDays.propertyId))
    .where(and(eq(properties.ownerUserId, userId), gt(listingViewDays.day, fromDay), lte(listingViewDays.day, toDay)));
  return row?.n ?? 0;
}

/** Views per listing over Nairobi days (fromDay, toDay], for the listings given (all the user's own). */
export async function viewsByListing(
  db: DbExecutor,
  userId: string,
  propertyIds: string[],
  fromDay: string,
  toDay: string,
): Promise<Map<string, number>> {
  if (propertyIds.length === 0) return new Map();
  const rows = await db
    .select({ id: listingViewDays.propertyId, n: sql<number>`sum(${listingViewDays.views})::int` })
    .from(listingViewDays)
    .innerJoin(properties, eq(properties.id, listingViewDays.propertyId))
    .where(
      and(
        eq(properties.ownerUserId, userId),
        inArray(listingViewDays.propertyId, propertyIds),
        gt(listingViewDays.day, fromDay),
        lte(listingViewDays.day, toDay),
      ),
    )
    .groupBy(listingViewDays.propertyId);
  return new Map(rows.map((r) => [r.id, r.n]));
}
