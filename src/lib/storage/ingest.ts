import "server-only";
import { ImageRejectedError, processImage, REJECT_MESSAGES } from "./image-processing";
import { isOwnUploadKey, newImageBaseKey, variantKeys } from "./keys";
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
    let raw: Buffer | null;
    try {
      raw = await privateStore.get(uploadKey, MAX_UPLOAD_BYTES);
    } catch (error) {
      if (error instanceof TooLargeError) throw new UploadError(REJECT_MESSAGES.size);
      throw error;
    }
    if (!raw) throw new UploadError("We did not receive that photo. Please try again.");

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
