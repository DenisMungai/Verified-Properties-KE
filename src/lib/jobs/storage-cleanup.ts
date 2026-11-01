import "server-only";
import { referencedAvatarKeys } from "@/db/queries/lister-profiles";
import { referencedBaseKeys } from "@/db/queries/listing-photos";
import { sweepOrphans } from "@/lib/storage/cleanup";
import type { JobDeps, JobResult } from "./types";

/** Orphaned uploads and photo variants (plan v2.0 §9; prompt S4 decision 10, S9 decision 13). */
export async function runStorageCleanup(deps: JobDeps): Promise<JobResult> {
  if (!deps.storage) return { status: "skipped", counts: { storageNotConfigured: 1 } };
  const result = await sweepOrphans({
    publicStore: deps.storage.public,
    privateStore: deps.storage.private,
    referencedBaseKeys: (keys) => referencedBaseKeys(deps.db, keys),
    referencedAvatarKeys: (keys) => referencedAvatarKeys(deps.db, keys),
    now: deps.now(),
  });
  return { status: "ok", counts: { uploadsDeleted: result.uploadsDeleted, imagesDeleted: result.imagesDeleted, avatarsDeleted: result.avatarsDeleted } };
}
