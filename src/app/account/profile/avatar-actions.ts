"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { clearAvatar, getListerProfile, setAvatar } from "@/db/queries/lister-profiles";
import type { ClientActionResult } from "@/lib/action-state";
import { invalidatePublicListings } from "@/lib/cache/public-listings";
import { POLICIES } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import {
  finalizeAvatarSlotUpload,
  removeAvatarSlotImage,
  requestAvatarSlotUpload,
  type AvatarSlot,
  type UploadRequestResult,
} from "@/lib/storage/avatar-upload";

/**
 * Lister profile photo (prompt lister-avatars), on the shared avatar pipeline
 * (`src/lib/storage/avatar-upload.ts`). Every action re-checks the session and the caller's own
 * lister profile.
 */

const PROFILE_PATH = "/account/profile";

const PROFILE_PHOTO: AvatarSlot<string> = {
  tag: "avatar",
  policy: POLICIES.avatarUploadPerUser,
  messages: {
    notSetUp: "Photo uploads are not set up yet.",
    notAllowed: "Save your listing profile first, then add a photo.",
    updated: "Profile photo updated.",
    removed: "Profile photo removed.",
  },
  resolve: async (userId) => ((await getListerProfile(getDb(), userId)) ? userId : null),
  storageOwner: (userId) => userId,
  save: (tx, userId, _target, baseKey) => (baseKey ? setAvatar(tx, userId, baseKey) : clearAvatar(tx, userId)),
};

export async function requestAvatarUploadAction(input: { contentType: string; size: number }): Promise<UploadRequestResult> {
  const user = await requireUser(PROFILE_PATH);
  return requestAvatarSlotUpload(PROFILE_PHOTO, user.id, input);
}

export async function finalizeAvatarUploadAction(input: { uploadKey: string }): Promise<ClientActionResult> {
  const user = await requireUser(PROFILE_PATH);
  const result = await finalizeAvatarSlotUpload(PROFILE_PHOTO, user.id, input);
  if (result.ok) {
    // Shown on the public cards and pages of every listing this image belongs to.
    invalidatePublicListings();
    refresh();
  }
  return result;
}

export async function removeAvatarAction(): Promise<ClientActionResult> {
  const user = await requireUser(PROFILE_PATH);
  const result = await removeAvatarSlotImage(PROFILE_PHOTO, user.id);
  if (result.ok) {
    // Shown on the public cards and pages of every listing this image belongs to.
    invalidatePublicListings();
    refresh();
  }
  return result;
}
