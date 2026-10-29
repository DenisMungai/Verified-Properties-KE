import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { properties, propertyImages } from "@/db/schema";
import { isEditableByLister, statusAfterEdit, type ListingStatus } from "@/lib/listings/workflow";
import { MAX_PHOTOS_PER_LISTING } from "@/lib/storage/limits";
import { isListerVerified } from "./billing";
import { getManageableListing, getPhotoSummary, type EditableListing } from "./listings";

/**
 * Listing photos (prompt S4). A photo is only reachable through a listing the user may manage
 * (`getManageableListing` applies `manageableBy`), so a forged listing or photo id finds nothing.
 * Writes take a transaction and lock the listing row first, so counts and cover changes from
 * parallel requests cannot interleave.
 */

const pi = propertyImages;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses in which the last photo must stay: the listing is live, in review or paused. */
const NEEDS_A_PHOTO: readonly ListingStatus[] = ["pending_review", "published", "paused"];

const photoColumns = {
  id: pi.id,
  storageKey: pi.storageKey,
  altText: pi.altText,
  width: pi.width,
  height: pi.height,
  sortOrder: pi.sortOrder,
  isCover: pi.isCover,
};

export type ListingPhoto = {
  id: string;
  storageKey: string;
  altText: string;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isCover: boolean;
};

export type PhotoFailure = "not_found" | "not_allowed" | "limit" | "last_photo";
export type PhotoResult<T = object> = ({ ok: true } & T) | { ok: false; reason: PhotoFailure };

const fail = (reason: PhotoFailure) => ({ ok: false, reason }) as const;

async function photosOf(db: DbExecutor, listingId: string): Promise<ListingPhoto[]> {
  return db.select(photoColumns).from(pi).where(eq(pi.propertyId, listingId)).orderBy(asc(pi.sortOrder), asc(pi.createdAt));
}

/** The listing's photos in display order, or null when the user may not manage it. */
export async function listPhotos(db: DbExecutor, userId: string, listingId: string): Promise<ListingPhoto[] | null> {
  const listing = await getManageableListing(db, userId, listingId);
  return listing ? photosOf(db, listingId) : null;
}

/** Whether this user may upload another photo to this listing right now (checked again on add). */
export async function canAddPhoto(db: DbExecutor, userId: string, listingId: string): Promise<PhotoResult<{ count: number }>> {
  const listing = await getManageableListing(db, userId, listingId);
  if (!listing) return fail("not_found");
  if (!isEditableByLister(listing.status)) return fail("not_allowed");
  const { count } = await getPhotoSummary(db, listingId);
  return count >= MAX_PHOTOS_PER_LISTING ? fail("limit") : { ok: true, count };
}

async function lockEditable(tx: DbExecutor, userId: string, listingId: string): Promise<EditableListing | PhotoFailure> {
  const listing = await getManageableListing(tx, userId, listingId, { forUpdate: true });
  if (!listing) return "not_found";
  return isEditableByLister(listing.status) ? listing : "not_allowed";
}

async function photoIn(tx: DbExecutor, listingId: string, photoId: string): Promise<ListingPhoto | null> {
  if (!UUID.test(photoId)) return null;
  const [row] = await tx
    .select(photoColumns)
    .from(pi)
    .where(and(eq(pi.id, photoId), eq(pi.propertyId, listingId)))
    .limit(1);
  return row ?? null;
}

/** Rewrites sort_order as 0..n-1 in the current order. */
async function renumber(tx: DbExecutor, listingId: string): Promise<void> {
  await tx.execute(sql`
    update property_images as img set sort_order = ranked.position
    from (
      select id, (row_number() over (order by sort_order, created_at, id) - 1)::int as position
      from property_images where property_id = ${listingId}
    ) as ranked
    where img.id = ranked.id and img.sort_order <> ranked.position`);
}

async function touchListing(tx: DbExecutor, listingId: string): Promise<void> {
  await tx.update(properties).set({ updatedAt: new Date() }).where(eq(properties.id, listingId));
}

/**
 * Adds a processed photo (prompt S4 decisions 5 and 6). The first photo becomes the cover. A new
 * photo is a material edit: an unverified owner's published listing goes back to review and a
 * paused one becomes a draft.
 */
export async function addPhoto(
  tx: DbExecutor,
  userId: string,
  listingId: string,
  image: { baseKey: string; altText: string; width: number; height: number },
): Promise<PhotoResult<{ photoId: string; status: ListingStatus; returnedToReview: boolean }>> {
  const listing = await lockEditable(tx, userId, listingId);
  if (typeof listing === "string") return fail(listing);

  const [{ count, next }] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      next: sql<number>`coalesce(max(${pi.sortOrder}) + 1, 0)::int`,
    })
    .from(pi)
    .where(eq(pi.propertyId, listingId));
  if (count >= MAX_PHOTOS_PER_LISTING) return fail("limit");

  const [row] = await tx
    .insert(pi)
    .values({
      propertyId: listingId,
      storageKey: image.baseKey,
      altText: image.altText,
      width: image.width,
      height: image.height,
      sortOrder: next,
      isCover: count === 0,
    })
    .returning({ id: pi.id });

  const checkVerified = listing.status === "published" || listing.status === "paused";
  const ownerVerified = checkVerified ? await isListerVerified(tx, listing.ownerUserId) : false;
  const status = statusAfterEdit(listing.status, true, ownerVerified);
  if (status !== listing.status) {
    const leftPause = listing.status === "paused";
    await tx
      .update(properties)
      .set({ status, ...(leftPause ? { pausedAt: null, pauseReason: null } : {}) })
      .where(and(eq(properties.id, listingId), eq(properties.status, listing.status)));
  } else {
    await touchListing(tx, listingId);
  }
  return { ok: true, photoId: row.id, status, returnedToReview: status !== listing.status };
}

export async function setCover(tx: DbExecutor, userId: string, listingId: string, photoId: string): Promise<PhotoResult> {
  const listing = await lockEditable(tx, userId, listingId);
  if (typeof listing === "string") return fail(listing);
  const photo = await photoIn(tx, listingId, photoId);
  if (!photo) return fail("not_found");
  if (photo.isCover) return { ok: true };
  // Clear first: the partial unique index allows one cover per listing.
  await tx.update(pi).set({ isCover: false }).where(and(eq(pi.propertyId, listingId), eq(pi.isCover, true)));
  await tx.update(pi).set({ isCover: true }).where(eq(pi.id, photoId));
  await touchListing(tx, listingId);
  return { ok: true };
}

export async function movePhoto(
  tx: DbExecutor,
  userId: string,
  listingId: string,
  photoId: string,
  direction: "up" | "down",
): Promise<PhotoResult> {
  const listing = await lockEditable(tx, userId, listingId);
  if (typeof listing === "string") return fail(listing);
  if (!(await photoIn(tx, listingId, photoId))) return fail("not_found");
  await renumber(tx, listingId);
  const ordered = await photosOf(tx, listingId);
  const from = ordered.findIndex((photo) => photo.id === photoId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length) return { ok: true };
  await tx.update(pi).set({ sortOrder: to }).where(eq(pi.id, ordered[from].id));
  await tx.update(pi).set({ sortOrder: from }).where(eq(pi.id, ordered[to].id));
  await touchListing(tx, listingId);
  return { ok: true };
}

/** `altText` must already be validated (`photoAltSchema`); the DB rejects blank text too. */
export async function updatePhotoAlt(
  tx: DbExecutor,
  userId: string,
  listingId: string,
  photoId: string,
  altText: string,
): Promise<PhotoResult> {
  const listing = await lockEditable(tx, userId, listingId);
  if (typeof listing === "string") return fail(listing);
  if (!(await photoIn(tx, listingId, photoId))) return fail("not_found");
  await tx.update(pi).set({ altText }).where(eq(pi.id, photoId));
  await touchListing(tx, listingId);
  return { ok: true };
}

/**
 * Removes a photo row and returns its base key so the caller can delete the stored files. The
 * next photo becomes the cover. A listing in review, live or paused keeps at least one photo.
 */
export async function deletePhoto(
  tx: DbExecutor,
  userId: string,
  listingId: string,
  photoId: string,
): Promise<PhotoResult<{ baseKey: string }>> {
  const listing = await lockEditable(tx, userId, listingId);
  if (typeof listing === "string") return fail(listing);
  const photo = await photoIn(tx, listingId, photoId);
  if (!photo) return fail("not_found");
  const { count } = await getPhotoSummary(tx, listingId);
  if (count <= 1 && NEEDS_A_PHOTO.includes(listing.status)) return fail("last_photo");

  await tx.delete(pi).where(eq(pi.id, photoId));
  await renumber(tx, listingId);
  if (photo.isCover) {
    const [first] = await photosOf(tx, listingId);
    if (first) await tx.update(pi).set({ isCover: true }).where(eq(pi.id, first.id));
  }
  await touchListing(tx, listingId);
  return { ok: true, baseKey: photo.storageKey };
}

/** Base keys of every photo on a listing, read before the listing row is deleted. */
export async function photoKeysForListing(db: DbExecutor, listingId: string): Promise<string[]> {
  const rows = await db.select({ key: pi.storageKey }).from(pi).where(eq(pi.propertyId, listingId));
  return rows.map((row) => row.key);
}

/** Which of these base keys still belong to a photo row (for orphan cleanup). */
export async function referencedBaseKeys(db: DbExecutor, baseKeys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < baseKeys.length; i += 500) {
    const rows = await db
      .select({ key: pi.storageKey })
      .from(pi)
      .where(inArray(pi.storageKey, baseKeys.slice(i, i + 500)));
    for (const row of rows) found.add(row.key);
  }
  return found;
}
