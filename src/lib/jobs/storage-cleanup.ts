import "server-only";
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
  const pruned = { jobRunsPruned: await pruneJobRuns(deps.db, now), deliveriesPruned: await pruneDeliveries(deps.db, now) };
  if (!deps.storage) return { status: "ok", counts: { ...pruned, storageNotConfigured: 1 } };
  const result = await sweepOrphans({
    publicStore: deps.storage.public,
    privateStore: deps.storage.private,
    referencedBaseKeys: (keys) => referencedBaseKeys(deps.db, keys),
    referencedAvatarKeys: (keys) => referencedAvatarKeys(deps.db, keys),
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
