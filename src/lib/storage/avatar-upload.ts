import "server-only";
import { z } from "zod";
import { withTransaction, type Tx } from "@/db/tx";
import { GENERIC_FAILURE, type ClientActionResult } from "@/lib/action-state";
import { failureLogger } from "@/lib/log";
import {
  RateLimitUnavailableError,
  checkRateLimits,
  rateLimitKey,
  tooManyAttemptsMessage,
  type RateLimitPolicy,
} from "@/lib/rate-limit";
import { getPrivateStore, getPublicStore } from "@/lib/storage";
import { REJECT_MESSAGES } from "@/lib/storage/image-processing";
import { deleteAvatarObjects, ingestAvatarUpload, UploadError } from "@/lib/storage/ingest";
import { newAvatarUploadKey } from "@/lib/storage/keys";
import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, PRESIGN_SECONDS } from "@/lib/storage/limits";
import { StorageNotConfiguredError } from "@/lib/storage/object-store";

/**
 * One round image held in the avatar store: a lister's profile photo (prompt lister-avatars) or an
 * agency's logo (prompt S23 decision 9). The browser uploads to a presigned URL in the private
 * bucket; finalize verifies and processes it into the public bucket. The owner is resolved on the
 * server at every step and re-checked when the row is written. Logs carry no keys or personal data.
 *
 * Callers (Server Actions) check the session first and refresh the page after a success.
 */

/** Type and size of an image the browser is about to upload (listing photos use it too). */
export const imageUploadRequestSchema = z.object({
  contentType: z.enum(IMAGE_MIME_TYPES, { error: REJECT_MESSAGES.type }),
  size: z.int().min(1, { error: "That file is empty." }).max(MAX_UPLOAD_BYTES, { error: REJECT_MESSAGES.size }),
});

const finalizeSchema = z.object({ uploadKey: z.string().max(200) });

export interface AvatarSlot<Target> {
  /** Log tag, e.g. `avatar`. */
  tag: string;
  policy: RateLimitPolicy;
  messages: {
    /** Storage is not configured. */
    notSetUp: string;
    /** The caller may not change this image (no profile, not an agency admin). */
    notAllowed: string;
    updated: string;
    removed: string;
  };
  /** What the caller may change, or null when they may not. Read-only. */
  resolve(userId: string): Promise<Target | null>;
  /** The owner segment upload keys are issued for; ingest accepts only keys issued for it. */
  storageOwner(target: Target): string;
  /**
   * Points the row at `baseKey` (null clears it) and returns the key it replaced, null when there
   * was none, or `undefined` when nothing was written because the caller lost the right.
   */
  save(tx: Tx, userId: string, target: Target, baseKey: string | null): Promise<string | null | undefined>;
}

export type UploadRequestResult = { ok: true; uploadUrl: string; uploadKey: string } | { ok: false; error: string };

/** Step 1: checks type, size, owner and rate limit, then signs one upload. */
export async function requestAvatarSlotUpload<Target>(
  slot: AvatarSlot<Target>,
  userId: string,
  input: { contentType: string; size: number },
): Promise<UploadRequestResult> {
  const parsed = imageUploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };

  try {
    const target = await slot.resolve(userId);
    if (!target) return { ok: false, error: slot.messages.notAllowed };
    const limit = await checkRateLimits([[slot.policy, rateLimitKey(userId)]]);
    if (!limit.ok) return { ok: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

    const uploadKey = newAvatarUploadKey(slot.storageOwner(target));
    const uploadUrl = await getPrivateStore().presignPut(uploadKey, parsed.data.contentType, parsed.data.size, PRESIGN_SECONDS);
    return { ok: true, uploadUrl, uploadKey };
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) return { ok: false, error: slot.messages.notSetUp };
    if (!(error instanceof RateLimitUnavailableError)) failureLogger(slot.tag)("request upload", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
}

/** Step 2: verifies and processes the upload, points the row at it, then drops the old image. */
export async function finalizeAvatarSlotUpload<Target>(
  slot: AvatarSlot<Target>,
  userId: string,
  input: { uploadKey: string },
): Promise<ClientActionResult> {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_FAILURE };

  // The new image's key until the row points at it; cleared after, so a later failure never
  // deletes the image in use. Ingest always deletes the temporary upload itself.
  let unclaimed: string | null = null;
  try {
    const target = await slot.resolve(userId);
    if (!target) return { ok: false, error: slot.messages.notAllowed };
    const publicStore = getPublicStore();
    const baseKey = await ingestAvatarUpload({
      privateStore: getPrivateStore(),
      publicStore,
      userId: slot.storageOwner(target),
      uploadKey: parsed.data.uploadKey,
    });
    unclaimed = baseKey;
    const previous = await withTransaction((tx) => slot.save(tx, userId, target, baseKey));
    if (previous === undefined) {
      await deleteAvatarObjects(publicStore, baseKey).catch(() => undefined);
      return { ok: false, error: slot.messages.notAllowed };
    }
    unclaimed = null;
    // A failed delete is left for the orphan sweep.
    if (previous) await deleteAvatarObjects(publicStore, previous).catch(() => undefined);
  } catch (error) {
    if (unclaimed) await deleteAvatarObjects(getPublicStore(), unclaimed).catch(() => undefined);
    if (error instanceof UploadError) return { ok: false, error: error.userMessage };
    if (error instanceof StorageNotConfiguredError) return { ok: false, error: slot.messages.notSetUp };
    failureLogger(slot.tag)("finalize upload", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  return { ok: true, message: slot.messages.updated };
}

/** Clears the image; cards fall back to initials. */
export async function removeAvatarSlotImage<Target>(slot: AvatarSlot<Target>, userId: string): Promise<ClientActionResult> {
  try {
    const target = await slot.resolve(userId);
    if (!target) return { ok: false, error: slot.messages.notAllowed };
    const removed = await withTransaction((tx) => slot.save(tx, userId, target, null));
    if (removed === undefined) return { ok: false, error: slot.messages.notAllowed };
    if (removed) await deleteAvatarObjects(getPublicStore(), removed).catch(() => undefined);
  } catch (error) {
    failureLogger(slot.tag)("remove", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  return { ok: true, message: slot.messages.removed };
}
