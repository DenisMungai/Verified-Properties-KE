import { randomUUID } from "node:crypto";
import { VARIANT_WIDTHS, variantSuffix } from "./limits";

/**
 * Storage keys. All are generated here; user-supplied file names never become part of a path.
 * - Temporary uploads (private bucket): `uploads/<userId>/<listingId>/<uuid>`
 * - Listing photos (public bucket): base key `listings/<listingId>/<imageId>`, one object per
 *   variant: `<base>-480.webp`, `<base>-960.webp`, `<base>-1600.webp`
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** User ids come from Better Auth: letters, digits, `_` and `-` only. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export const UPLOADS_PREFIX = "uploads/";
export const LISTINGS_PREFIX = "listings/";

export function uploadKeyPrefix(userId: string, listingId: string): string {
  if (!SAFE_SEGMENT.test(userId) || !UUID.test(listingId)) throw new Error("Unsafe storage key segment");
  return `${UPLOADS_PREFIX}${userId}/${listingId}/`;
}

export function newUploadKey(userId: string, listingId: string): string {
  return `${uploadKeyPrefix(userId, listingId)}${randomUUID()}`;
}

/** True only for a key this user was issued for this listing. */
export function isOwnUploadKey(key: string, userId: string, listingId: string): boolean {
  let prefix: string;
  try {
    prefix = uploadKeyPrefix(userId, listingId);
  } catch {
    return false;
  }
  if (!key.startsWith(prefix)) return false;
  return UUID.test(key.slice(prefix.length));
}

export function newImageBaseKey(listingId: string): string {
  if (!UUID.test(listingId)) throw new Error("Unsafe storage key segment");
  return `${LISTINGS_PREFIX}${listingId}/${randomUUID()}`;
}

export function variantKeys(baseKey: string): string[] {
  return VARIANT_WIDTHS.map((width) => `${baseKey}${variantSuffix(width)}`);
}

/** The image base key a stored variant belongs to, or null for anything else. */
export function baseKeyOfVariant(key: string): string | null {
  const match = /^(listings\/[0-9a-f-]{36}\/[0-9a-f-]{36})-\d+\.webp$/i.exec(key);
  return match ? match[1] : null;
}
