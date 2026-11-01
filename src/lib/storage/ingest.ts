import "server-only";
import { ImageRejectedError, processAvatar, processImage, REJECT_MESSAGES } from "./image-processing";
import {
  avatarVariantKeys,
  isOwnAvatarUploadKey,
  isOwnUploadKey,
  newAvatarBaseKey,
  newImageBaseKey,
  variantKeys,
} from "./keys";
import { MAX_UPLOAD_BYTES, variantSuffix } from "./limits";
import { IMMUTABLE_CACHE, TooLargeError, type ObjectStore } from "./object-store";

export class UploadError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "UploadError";
  }
}

export interface IngestedImage {
  baseKey: string;
  width: number;
  height: number;
}

/**
 * Turns a browser upload in the private bucket into verified, metadata-free WebP variants in the
 * public bucket. The temporary upload is always deleted, whether processing succeeds or fails.
 */
export async function ingestUpload(args: {
  privateStore: ObjectStore;
  publicStore: ObjectStore;
  userId: string;
  listingId: string;
  uploadKey: string;
}): Promise<IngestedImage> {
  const { privateStore, publicStore, userId, listingId, uploadKey } = args;
  // Only a key issued to this user for this listing, so nobody can ingest another person's
  // upload or an arbitrary object in the bucket.
  if (!isOwnUploadKey(uploadKey, userId, listingId)) {
    throw new UploadError("That upload is not valid. Please try again.");
  }

  try {
    const raw = await readUpload(privateStore, uploadKey);
    let processed;
    try {
      processed = await processImage(raw);
    } catch (error) {
      if (error instanceof ImageRejectedError) throw new UploadError(error.reason);
      throw error;
    }

    const baseKey = newImageBaseKey(listingId);
    try {
      for (const variant of processed.variants) {
        await publicStore.put(`${baseKey}${variantSuffix(variant.width)}`, variant.body, "image/webp", IMMUTABLE_CACHE);
      }
    } catch (error) {
      await deleteImageObjects(publicStore, baseKey).catch(() => undefined);
      throw error;
    }
    return { baseKey, width: processed.width, height: processed.height };
  } finally {
    await privateStore.delete([uploadKey]).catch(() => undefined);
  }
}

/** Removes every stored variant of one photo. */
export async function deleteImageObjects(store: ObjectStore, baseKey: string): Promise<void> {
  await store.delete(variantKeys(baseKey));
}

/** Reads a temporary upload, translating storage errors into the words shown to the user. */
async function readUpload(privateStore: ObjectStore, uploadKey: string): Promise<Buffer> {
  let raw: Buffer | null;
  try {
    raw = await privateStore.get(uploadKey, MAX_UPLOAD_BYTES);
  } catch (error) {
    if (error instanceof TooLargeError) throw new UploadError(REJECT_MESSAGES.size);
    throw error;
  }
  if (!raw) throw new UploadError("We did not receive that photo. Please try again.");
  return raw;
}

/**
 * A lister's profile photo, the same way as `ingestUpload`: only this user's own avatar upload
 * key, square WebP variants in the public bucket, and the temporary upload always deleted.
 * Returns the new avatar base key.
 */
export async function ingestAvatarUpload(args: {
  privateStore: ObjectStore;
  publicStore: ObjectStore;
  userId: string;
  uploadKey: string;
}): Promise<string> {
  const { privateStore, publicStore, userId, uploadKey } = args;
  if (!isOwnAvatarUploadKey(uploadKey, userId)) throw new UploadError("That upload is not valid. Please try again.");

  try {
    const raw = await readUpload(privateStore, uploadKey);
    let variants;
    try {
      variants = await processAvatar(raw);
    } catch (error) {
      if (error instanceof ImageRejectedError) throw new UploadError(error.reason);
      throw error;
    }

    const baseKey = newAvatarBaseKey(userId);
    try {
      for (const variant of variants) {
        await publicStore.put(`${baseKey}${variantSuffix(variant.size)}`, variant.body, "image/webp", IMMUTABLE_CACHE);
      }
    } catch (error) {
      await deleteAvatarObjects(publicStore, baseKey).catch(() => undefined);
      throw error;
    }
    return baseKey;
  } finally {
    await privateStore.delete([uploadKey]).catch(() => undefined);
  }
}

/** Removes every stored variant of one avatar. */
export async function deleteAvatarObjects(store: ObjectStore, baseKey: string): Promise<void> {
  await store.delete(avatarVariantKeys(baseKey));
}
