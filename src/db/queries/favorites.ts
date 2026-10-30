import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { favorites, properties } from "@/db/schema";

/**
 * Saved listings (prompt S8 decision 6). Saving needs a published listing; unsaving always works,
 * so a paused listing can still be removed. Repeating either is harmless.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FavoriteResult = { ok: true; saved: boolean } | { ok: false; reason: "unavailable" };

export async function setFavorite(db: DbExecutor, userId: string, propertyId: string, saved: boolean): Promise<FavoriteResult> {
  if (!UUID.test(propertyId)) return { ok: false, reason: "unavailable" };
  if (!saved) {
    await db.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.propertyId, propertyId)));
    return { ok: true, saved: false };
  }
  await db.execute(sql`
    insert into ${favorites} (user_id, property_id)
    select ${userId}, ${properties.id} from ${properties}
    where ${properties.id} = ${propertyId} and ${properties.status} = 'published'
    on conflict do nothing`);
  const [row] = await db
    .select({ propertyId: favorites.propertyId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.propertyId, propertyId)))
    .limit(1);
  return row ? { ok: true, saved: true } : { ok: false, reason: "unavailable" };
}

/** Which of these listing ids the user has saved. */
export async function savedIdsAmong(db: DbExecutor, userId: string, propertyIds: string[]): Promise<Set<string>> {
  if (propertyIds.length === 0) return new Set();
  const rows = await db
    .select({ propertyId: favorites.propertyId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), inArray(favorites.propertyId, propertyIds)));
  return new Set(rows.map((row) => row.propertyId));
}
