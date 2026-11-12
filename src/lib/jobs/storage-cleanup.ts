import "server-only";
import { referencedLogoKeys } from "@/db/queries/agencies";
import { pruneAgencyInvites } from "@/db/queries/agency-invites";
import { pruneJobRuns } from "@/db/queries/job-runs";
import { referencedAvatarKeys } from "@/db/queries/lister-profiles";
import { referencedBaseKeys } from "@/db/queries/listing-photos";
import { pruneDeliveries } from "@/db/queries/notification-deliveries";
import { referencedDocumentKeys } from "@/db/queries/verification";
import { sweepOrphans } from "@/lib/storage/cleanup";
import type { JobDeps, JobResult } from "./types";

/**
 * Orphaned uploads and photo variants (plan v2.0 §9; prompt S4 decision 10, S9 decision 13), then
 * old job runs and delivery rows (prompt S16 decision 10). The prune runs even without storage.
 */
export async function runStorageCleanup(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const pruned = {
    jobRunsPruned: await pruneJobRuns(deps.db, now),
    deliveriesPruned: await pruneDeliveries(deps.db, now),
    agencyInvitesPruned: await pruneAgencyInvites(deps.db, now),
  };
  if (!deps.storage) return { status: "ok", counts: { ...pruned, storageNotConfigured: 1 } };
  const result = await sweepOrphans({
    publicStore: deps.storage.public,
    privateStore: deps.storage.private,
    referencedBaseKeys: (keys) => referencedBaseKeys(deps.db, keys),
    // Agency logos share the avatar store (prompt S23 decision 9), so both tables count as references.
    referencedAvatarKeys: async (keys) => {
      const [avatars, logos] = await Promise.all([referencedAvatarKeys(deps.db, keys), referencedLogoKeys(deps.db, keys)]);
      return new Set([...avatars, ...logos]);
    },
    referencedDocumentKeys: (keys) => referencedDocumentKeys(deps.db, keys),
    now,
  });
  return {
    status: "ok",
    counts: {
      ...pruned,
      uploadsDeleted: result.uploadsDeleted,
      imagesDeleted: result.imagesDeleted,
      avatarsDeleted: result.avatarsDeleted,
      documentsDeleted: result.documentsDeleted,
    },
  };
}
