import "server-only";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { listingViewDays, properties } from "@/db/schema";

/**
 * Adds one view to a published listing's counter for `day` (prompt S13 decision 12). Nothing
 * happens for a listing that isn't published, or when the viewer owns it. Counts only.
 */
export async function recordListingView(db: DbExecutor, propertyId: string, day: string, viewerUserId: string | null): Promise<void> {
  const notOwner = viewerUserId ? sql`and ${properties.ownerUserId} <> ${viewerUserId}` : sql``;
  await db.execute(sql`
    insert into ${listingViewDays} (property_id, day, views)
    select ${properties.id}, ${day}::date, 1
    from ${properties}
    where ${properties.id} = ${propertyId} and ${properties.status} = 'published' ${notOwner}
    on conflict (property_id, day) do update set views = ${listingViewDays}.views + 1
  `);
}
