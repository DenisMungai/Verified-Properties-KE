"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  addPhoto,
  canAddPhoto,
  deletePhoto,
  movePhoto,
  setCover,
  updatePhotoAlt,
  type PhotoFailure,
  type PhotoResult,
} from "@/db/queries/listing-photos";
import { getDb } from "@/db";
import { withTransaction } from "@/db/tx";
import { type ClientActionResult, GENERIC_FAILURE } from "@/lib/action-state";
import { invalidateListing } from "@/lib/cache/public-listings";
import { failureLogger } from "@/lib/log";
import { POLICIES, RateLimitUnavailableError, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { getPrivateStore, getPublicStore } from "@/lib/storage";
import { imageUploadRequestSchema } from "@/lib/storage/avatar-upload";
import { deleteImageObjects, ingestUpload, UploadError } from "@/lib/storage/ingest";
import { isOwnUploadKey, newUploadKey } from "@/lib/storage/keys";
import { MAX_PHOTOS_PER_LISTING, PRESIGN_SECONDS } from "@/lib/storage/limits";
import { StorageNotConfiguredError } from "@/lib/storage/object-store";
import { photoAltSchema } from "@/lib/validation/listing";
import { requireLister } from "./guard";
import { deleteStoredPhotos } from "./stored-photos";

/**
 * Photo Server Actions (prompt S4). File bytes never pass through here: the browser uploads to a
 * presigned URL, then `finalizePhotoUploadAction` verifies and processes the object. Every action
 * re-checks the session, the manage rule and the listing status. Logs carry no keys, file names,
 * descriptions or personal data.
 */

const NOT_SET_UP = "Photo uploads are not set up yet.";

const FAILURE_MESSAGES: Record<PhotoFailure, string> = {
  not_found: "We couldn't find that listing or photo.",
  not_allowed: "Photos can't be changed on this listing right now.",
  limit: `A listing can have up to ${MAX_PHOTOS_PER_LISTING} photos.`,
  last_photo: "A listing that's live, in review or paused needs at least one photo.",
};

const listingId = z.uuid({ error: "We couldn't find that listing." });
const photoId = z.uuid({ error: "We couldn't find that photo." });

const logFailure = failureLogger("photos");

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? GENERIC_FAILURE;
}

// listingId first, so its error is the one shown when several fields fail.
const uploadRequestSchema = z.object({ listingId, ...imageUploadRequestSchema.shape });

/** Step 1: checks everything that can be checked before the bytes arrive, then signs one upload. */
export async function requestPhotoUploadAction(input: {
  listingId: string;
  contentType: string;
  size: number;
}): Promise<{ ok: true; uploadUrl: string; uploadKey: string } | { ok: false; error: string }> {
  const user = await requireLister("/account/listings");
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { listingId: id, contentType, size } = parsed.data;

  try {
    const allowed = await canAddPhoto(getDb(), user.id, id);
    if (!allowed.ok) return { ok: false, error: FAILURE_MESSAGES[allowed.reason] };
    const limit = await checkRateLimits([[POLICIES.photoUploadPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { ok: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

    const uploadKey = newUploadKey(user.id, id);
    const uploadUrl = await getPrivateStore().presignPut(uploadKey, contentType, size, PRESIGN_SECONDS);
    return { ok: true, uploadUrl, uploadKey };
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      console.error("[storage] not configured");
      return { ok: false, error: NOT_SET_UP };
    }
    if (!(error instanceof RateLimitUnavailableError)) logFailure("request upload", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
}

const finalizeSchema = z.object({ listingId, uploadKey: z.string().max(200), altText: photoAltSchema });

function addedMessage(result: { status: string; returnedToReview: boolean }): string | undefined {
  if (!result.returnedToReview) return undefined;
  return result.status === "draft"
    ? "Photo added. The listing is a draft again, so submit it when you're ready."
    : "Photo added. You added photos, so the listing is back in review.";
}

/** Step 2: verifies and processes the uploaded object, then records the photo. */
export async function finalizePhotoUploadAction(input: z.input<typeof finalizeSchema>): Promise<ClientActionResult> {
  const user = await requireLister("/account/listings");
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { listingId: id, uploadKey, altText } = parsed.data;

  let publicStore;
  try {
    const allowed = await canAddPhoto(getDb(), user.id, id);
    if (!allowed.ok) {
      // Only ever delete a key this user was issued for this listing.
      if (isOwnUploadKey(uploadKey, user.id, id)) await getPrivateStore().delete([uploadKey]).catch(() => undefined);
      return { ok: false, error: FAILURE_MESSAGES[allowed.reason] };
    }
    publicStore = getPublicStore();
    const ingested = await ingestUpload({ privateStore: getPrivateStore(), publicStore, userId: user.id, listingId: id, uploadKey });
    const added = await withTransaction((tx) => addPhoto(tx, user.id, id, { ...ingested, altText }));
    if (!added.ok) {
      await deleteImageObjects(publicStore, ingested.baseKey).catch(() => undefined);
      return { ok: false, error: FAILURE_MESSAGES[added.reason] };
    }
    invalidateListing(id);
    refresh();
    return { ok: true, message: addedMessage(added) };
  } catch (error) {
    if (error instanceof UploadError) return { ok: false, error: error.userMessage };
    if (error instanceof StorageNotConfiguredError) return { ok: false, error: NOT_SET_UP };
    logFailure("finalize upload", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
}

/** Shared shell for the small photo edits: auth, validation, one transaction, cache clear, refresh. */
async function photoEdit(
  action: string,
  ids: { listingId: string; photoId: string },
  run: (userId: string, listingId: string, photoId: string) => Promise<PhotoResult>,
): Promise<ClientActionResult> {
  const user = await requireLister("/account/listings");
  const parsed = z.object({ listingId, photoId }).safeParse(ids);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  try {
    const result = await run(user.id, parsed.data.listingId, parsed.data.photoId);
    if (!result.ok) return { ok: false, error: FAILURE_MESSAGES[result.reason] };
  } catch (error) {
    logFailure(action, error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  invalidateListing(parsed.data.listingId);
  refresh();
  return { ok: true };
}

export async function setCoverPhotoAction(ids: { listingId: string; photoId: string }): Promise<ClientActionResult> {
  return photoEdit("set cover", ids, (userId, l, p) => withTransaction((tx) => setCover(tx, userId, l, p)));
}

export async function movePhotoAction(
  ids: { listingId: string; photoId: string },
  direction: "up" | "down",
): Promise<ClientActionResult> {
  if (direction !== "up" && direction !== "down") return { ok: false, error: GENERIC_FAILURE };
  return photoEdit("move", ids, (userId, l, p) => withTransaction((tx) => movePhoto(tx, userId, l, p, direction)));
}

export async function updatePhotoAltAction(
  ids: { listingId: string; photoId: string },
  altText: string,
): Promise<ClientActionResult> {
  const alt = photoAltSchema.safeParse(altText);
  if (!alt.success) return { ok: false, error: firstError(alt.error) };
  return photoEdit("update description", ids, (userId, l, p) =>
    withTransaction((tx) => updatePhotoAlt(tx, userId, l, p, alt.data)),
  );
}

export async function deletePhotoAction(ids: { listingId: string; photoId: string }): Promise<ClientActionResult> {
  return photoEdit("delete", ids, async (userId, l, p) => {
    const result = await withTransaction((tx) => deletePhoto(tx, userId, l, p));
    if (result.ok) await deleteStoredPhotos([result.baseKey]);
    return result;
  });
}
