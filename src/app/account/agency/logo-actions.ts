"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { adminAgencyId, setAgencyLogo } from "@/db/queries/agencies";
import { withTransaction } from "@/db/tx";
import { POLICIES, RateLimitUnavailableError, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { getPrivateStore, getPublicStore } from "@/lib/storage";
import { REJECT_MESSAGES } from "@/lib/storage/image-processing";
import { deleteAvatarObjects, ingestAvatarUpload, UploadError } from "@/lib/storage/ingest";
import { agencyLogoOwner, newAvatarUploadKey } from "@/lib/storage/keys";
import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, PRESIGN_SECONDS } from "@/lib/storage/limits";
import { StorageNotConfiguredError } from "@/lib/storage/object-store";

/**
 * Agency logo (prompt S23 decision 9): the avatar pipeline with the owner segment
 * `agency-<agencyId>`. Only an admin of the caller's own agency may upload or remove; the agency
 * is found on the server every time and re-checked when the row is written.
 */

export type LogoActionResult = { ok: true; message: string } | { ok: false; error: string };

const AGENCY_PATH = "/account/agency";
const GENERIC_FAILURE = "Something went wrong. Please try again.";
const NOT_SET_UP = "Logo uploads are not set up yet.";
const NOT_ADMIN = "Only an admin of your agency can change its logo.";

function logFailure(action: string, error: unknown): void {
  console.error(`[agency-logo] ${action} failed`, error instanceof Error ? error.name : "unknown");
}

const uploadRequestSchema = z.object({
  contentType: z.enum(IMAGE_MIME_TYPES, { error: REJECT_MESSAGES.type }),
  size: z.int().min(1, { error: "That file is empty." }).max(MAX_UPLOAD_BYTES, { error: REJECT_MESSAGES.size }),
});

export async function requestLogoUploadAction(input: {
  contentType: string;
  size: number;
}): Promise<{ ok: true; uploadUrl: string; uploadKey: string } | { ok: false; error: string }> {
  const user = await requireUser(AGENCY_PATH);
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };

  try {
    const agencyId = await adminAgencyId(getDb(), user.id);
    if (!agencyId) return { ok: false, error: NOT_ADMIN };
    const limit = await checkRateLimits([[POLICIES.agencyLogoUploadPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { ok: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

    const uploadKey = newAvatarUploadKey(agencyLogoOwner(agencyId));
    const uploadUrl = await getPrivateStore().presignPut(uploadKey, parsed.data.contentType, parsed.data.size, PRESIGN_SECONDS);
    return { ok: true, uploadUrl, uploadKey };
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) return { ok: false, error: NOT_SET_UP };
    if (!(error instanceof RateLimitUnavailableError)) logFailure("request upload", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
}

export async function finalizeLogoUploadAction(input: { uploadKey: string }): Promise<LogoActionResult> {
  const user = await requireUser(AGENCY_PATH);
  const parsed = z.object({ uploadKey: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_FAILURE };

  let unclaimed: string | null = null;
  try {
    const agencyId = await adminAgencyId(getDb(), user.id);
    if (!agencyId) return { ok: false, error: NOT_ADMIN };
    const publicStore = getPublicStore();
    // Only an upload key issued for this agency passes ingest's ownership check.
    const baseKey = await ingestAvatarUpload({
      privateStore: getPrivateStore(),
      publicStore,
      userId: agencyLogoOwner(agencyId),
      uploadKey: parsed.data.uploadKey,
    });
    unclaimed = baseKey;
    const previous = await withTransaction((tx) => setAgencyLogo(tx, user.id, agencyId, baseKey));
    if (previous === undefined) {
      await deleteAvatarObjects(publicStore, baseKey).catch(() => undefined);
      return { ok: false, error: NOT_ADMIN };
    }
    unclaimed = null;
    if (previous) await deleteAvatarObjects(publicStore, previous).catch(() => undefined);
  } catch (error) {
    if (unclaimed) await deleteAvatarObjects(getPublicStore(), unclaimed).catch(() => undefined);
    if (error instanceof UploadError) return { ok: false, error: error.userMessage };
    if (error instanceof StorageNotConfiguredError) return { ok: false, error: NOT_SET_UP };
    logFailure("finalize upload", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  refresh();
  return { ok: true, message: "Logo updated." };
}

export async function removeLogoAction(): Promise<LogoActionResult> {
  const user = await requireUser(AGENCY_PATH);
  try {
    const agencyId = await adminAgencyId(getDb(), user.id);
    if (!agencyId) return { ok: false, error: NOT_ADMIN };
    const removed = await withTransaction((tx) => setAgencyLogo(tx, user.id, agencyId, null));
    if (removed === undefined) return { ok: false, error: NOT_ADMIN };
    if (removed) await deleteAvatarObjects(getPublicStore(), removed).catch(() => undefined);
  } catch (error) {
    logFailure("remove", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  refresh();
  return { ok: true, message: "Logo removed." };
}
