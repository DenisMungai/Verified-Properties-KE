"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { adminAgencyId, setAgencyLogo } from "@/db/queries/agencies";
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
import { agencyLogoOwner } from "@/lib/storage/keys";

/**
 * Agency logo (prompt S23 decision 9): the shared avatar pipeline with the owner segment
 * `agency-<agencyId>`. Only an admin of the caller's own agency may upload or remove; the agency
 * is found on the server every time and re-checked when the row is written.
 */

const AGENCY_PATH = "/account/agency";

const AGENCY_LOGO: AvatarSlot<string> = {
  tag: "agency-logo",
  policy: POLICIES.agencyLogoUploadPerUser,
  messages: {
    notSetUp: "Logo uploads are not set up yet.",
    notAllowed: "Only an admin of your agency can change its logo.",
    updated: "Logo updated.",
    removed: "Logo removed.",
  },
  resolve: (userId) => adminAgencyId(getDb(), userId),
  storageOwner: (agencyId) => agencyLogoOwner(agencyId),
  save: (tx, userId, agencyId, baseKey) => setAgencyLogo(tx, userId, agencyId, baseKey),
};

export async function requestLogoUploadAction(input: { contentType: string; size: number }): Promise<UploadRequestResult> {
  const user = await requireUser(AGENCY_PATH);
  return requestAvatarSlotUpload(AGENCY_LOGO, user.id, input);
}

export async function finalizeLogoUploadAction(input: { uploadKey: string }): Promise<ClientActionResult> {
  const user = await requireUser(AGENCY_PATH);
  const result = await finalizeAvatarSlotUpload(AGENCY_LOGO, user.id, input);
  if (result.ok) {
    // Shown on the public cards and pages of every listing this image belongs to.
    invalidatePublicListings();
    refresh();
  }
  return result;
}

export async function removeLogoAction(): Promise<ClientActionResult> {
  const user = await requireUser(AGENCY_PATH);
  const result = await removeAvatarSlotImage(AGENCY_LOGO, user.id);
  if (result.ok) {
    // Shown on the public cards and pages of every listing this image belongs to.
    invalidatePublicListings();
    refresh();
  }
  return result;
}
