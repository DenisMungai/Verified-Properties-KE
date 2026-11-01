import { randomUUID } from "node:crypto";
import { AVATAR_SIZES, VARIANT_WIDTHS, variantSuffix } from "./limits";

/**
 * Storage keys. All are generated here; user-supplied file names never become part of a path.
 * - Temporary uploads (private bucket): `uploads/<userId>/<listingId>/<uuid>`
 * - Listing photos (public bucket): base key `listings/<listingId>/<imageId>`, one object per
 *   variant: `<base>-480.webp`, `<base>-960.webp`, `<base>-1600.webp`
 * - Avatar uploads (private bucket): `uploads/<userId>/avatar/<uuid>`
 * - Avatars (public bucket): base key `avatars/<userId>/<uuid>`, variants `<base>-128.webp` and
 *   `<base>-384.webp`
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** User ids come from Better Auth: letters, digits, `_` and `-` only. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export const UPLOADS_PREFIX = "uploads/";
export const LISTINGS_PREFIX = "listings/";
export const AVATARS_PREFIX = "avatars/";

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

/* ---------------------------------- avatars ---------------------------------- */

function avatarUploadPrefix(userId: string): string {
  if (!SAFE_SEGMENT.test(userId)) throw new Error("Unsafe storage key segment");
  // "avatar" is never a UUID, so this can't overlap a listing upload prefix.
  return `${UPLOADS_PREFIX}${userId}/avatar/`;
}

export function newAvatarUploadKey(userId: string): string {
  return `${avatarUploadPrefix(userId)}${randomUUID()}`;
}

/** True only for an avatar upload key issued to this user. */
export function isOwnAvatarUploadKey(key: string, userId: string): boolean {
  let prefix: string;
  try {
    prefix = avatarUploadPrefix(userId);
  } catch {
    return false;
  }
  return key.startsWith(prefix) && UUID.test(key.slice(prefix.length));
}

export function newAvatarBaseKey(userId: string): string {
  if (!SAFE_SEGMENT.test(userId)) throw new Error("Unsafe storage key segment");
  return `${AVATARS_PREFIX}${userId}/${randomUUID()}`;
}

export function avatarVariantKeys(baseKey: string): string[] {
  return AVATAR_SIZES.map((size) => `${baseKey}${variantSuffix(size)}`);
}

/** The avatar base key a stored variant belongs to, or null for anything else. */
export function baseKeyOfAvatarVariant(key: string): string | null {
  const match = /^(avatars\/[A-Za-z0-9_-]{1,64}\/[0-9a-f-]{36})-(?:128|384)\.webp$/i.exec(key);
  return match ? match[1] : null;
}
