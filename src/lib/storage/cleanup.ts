import "server-only";
import { baseKeyOfVariant, LISTINGS_PREFIX, UPLOADS_PREFIX } from "./keys";
import type { ObjectStore } from "./object-store";

/** Objects younger than this are left alone: an upload or ingest may still be running. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  uploadsDeleted: number;
  imagesDeleted: number;
}

/**
 * Deletes storage nobody references (plan §9 "cleanup of orphaned uploads"):
 * - temporary uploads older than 24 hours (finalize never ran)
 * - public variants older than 24 hours whose photo row is gone (a failed delete or insert)
 * S9 calls this from a QStash job. `referencedBaseKeys` returns which base keys still have a row.
 */
export async function sweepOrphans(args: {
  publicStore: ObjectStore;
  privateStore: ObjectStore;
  referencedBaseKeys: (baseKeys: string[]) => Promise<Set<string>>;
  now?: Date;
}): Promise<SweepResult> {
  const cutoff = (args.now ?? new Date()).getTime() - ORPHAN_AGE_MS;
  const isOld = (lastModified: Date) => lastModified.getTime() < cutoff;

  const staleUploads = (await args.privateStore.list(UPLOADS_PREFIX)).filter((o) => isOld(o.lastModified));
  await args.privateStore.delete(staleUploads.map((o) => o.key));

  const oldVariants = (await args.publicStore.list(LISTINGS_PREFIX)).filter((o) => isOld(o.lastModified));
  const baseKeys = [...new Set(oldVariants.map((o) => baseKeyOfVariant(o.key)).filter((k): k is string => k !== null))];
  const referenced = baseKeys.length > 0 ? await args.referencedBaseKeys(baseKeys) : new Set<string>();
  const orphaned = oldVariants.filter((o) => {
    const base = baseKeyOfVariant(o.key);
    return base !== null && !referenced.has(base);
  });
  await args.publicStore.delete(orphaned.map((o) => o.key));

  return { uploadsDeleted: staleUploads.length, imagesDeleted: orphaned.length };
}
