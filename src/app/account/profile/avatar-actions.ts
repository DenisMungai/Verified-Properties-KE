"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { clearAvatar, getListerProfile, setAvatar } from "@/db/queries/lister-profiles";
import { withTransaction } from "@/db/tx";
import { POLICIES, RateLimitUnavailableError, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { getPrivateStore, getPublicStore } from "@/lib/storage";
import { REJECT_MESSAGES } from "@/lib/storage/image-processing";
import { deleteAvatarObjects, ingestAvatarUpload, UploadError } from "@/lib/storage/ingest";
import { newAvatarUploadKey } from "@/lib/storage/keys";
import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, PRESIGN_SECONDS } from "@/lib/storage/limits";
import { StorageNotConfiguredError } from "@/lib/storage/object-store";

/**
 * Lister profile photo (prompt lister-avatars). Same shape as the listing photo actions: the
 * browser uploads to a presigned URL in the private bucket, then `finalizeAvatarUploadAction`
 * verifies and processes it. Every action re-checks the session and the caller's own lister
 * profile. Logs carry no keys or personal data.
 */

export type AvatarActionResult = { ok: true; message: string } | { ok: false; error: string };

const PROFILE_PATH = "/account/profile";
const GENERIC_FAILURE = "Something went wrong. Please try again.";
const NOT_SET_UP = "Photo uploads are not set up yet.";
const NO_PROFILE = "Save your listing profile first, then add a photo.";

function logFailure(action: string, error: unknown): void {
  console.error(`[avatar] ${action} failed`, error instanceof Error ? error.name : "unknown");
}

const uploadRequestSchema = z.object({
  contentType: z.enum(IMAGE_MIME_TYPES, { error: REJECT_MESSAGES.type }),
  size: z.int().min(1, { error: "That file is empty." }).max(MAX_UPLOAD_BYTES, { error: REJECT_MESSAGES.size }),
});

/** Step 1: checks type, size, profile and rate limit, then signs one upload. */
export async function requestAvatarUploadAction(input: {
  contentType: string;
  size: number;
}): Promise<{ ok: true; uploadUrl: string; uploadKey: string } | { ok: false; error: string }> {
  const user = await requireUser(PROFILE_PATH);
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };

  try {
    if (!(await getListerProfile(getDb(), user.id))) return { ok: false, error: NO_PROFILE };
    const limit = await checkRateLimits([[POLICIES.avatarUploadPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { ok: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

    const uploadKey = newAvatarUploadKey(user.id);
    const uploadUrl = await getPrivateStore().presignPut(uploadKey, parsed.data.contentType, parsed.data.size, PRESIGN_SECONDS);
    return { ok: true, uploadUrl, uploadKey };
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) return { ok: false, error: NOT_SET_UP };
    if (!(error instanceof RateLimitUnavailableError)) logFailure("request upload", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
}

/** Step 2: verifies and processes the upload, points the profile at it, then drops the old photo. */
export async function finalizeAvatarUploadAction(input: { uploadKey: string }): Promise<AvatarActionResult> {
  const user = await requireUser(PROFILE_PATH);
  const parsed = z.object({ uploadKey: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_FAILURE };
  const { uploadKey } = parsed.data;

  // The new photo's key until the profile points at it; cleared after, so a later failure
  // never deletes the photo in use. Ingest always deletes the temporary upload itself.
  let unclaimed: string | null = null;
  try {
    const publicStore = getPublicStore();
    const baseKey = await ingestAvatarUpload({ privateStore: getPrivateStore(), publicStore, userId: user.id, uploadKey });
    unclaimed = baseKey;
    const previous = await withTransaction((tx) => setAvatar(tx, user.id, baseKey));
    if (previous === undefined) {
      await deleteAvatarObjects(publicStore, baseKey).catch(() => undefined);
      return { ok: false, error: NO_PROFILE };
    }
    unclaimed = null;
    // A failed delete is left for the orphan sweep.
    if (previous) await deleteAvatarObjects(publicStore, previous).catch(() => undefined);
  } catch (error) {
    if (unclaimed) await deleteAvatarObjects(getPublicStore(), unclaimed).catch(() => undefined);
    if (error instanceof UploadError) return { ok: false, error: error.userMessage };
    if (error instanceof StorageNotConfiguredError) return { ok: false, error: NOT_SET_UP };
    logFailure("finalize upload", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  refresh();
  return { ok: true, message: "Profile photo updated." };
}

/** Clears the profile photo; listings fall back to initials. */
export async function removeAvatarAction(): Promise<AvatarActionResult> {
  const user = await requireUser(PROFILE_PATH);
  try {
    const removed = await withTransaction((tx) => clearAvatar(tx, user.id));
    if (removed) await deleteAvatarObjects(getPublicStore(), removed).catch(() => undefined);
  } catch (error) {
    logFailure("remove", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  refresh();
  return { ok: true, message: "Profile photo removed." };
}
