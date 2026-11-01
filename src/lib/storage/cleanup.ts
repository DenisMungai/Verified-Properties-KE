import "server-only";
import { AVATARS_PREFIX, baseKeyOfAvatarVariant, baseKeyOfVariant, LISTINGS_PREFIX, UPLOADS_PREFIX } from "./keys";
import type { ObjectStore } from "./object-store";

/** Objects younger than this are left alone: an upload or ingest may still be running. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  uploadsDeleted: number;
  imagesDeleted: number;
  avatarsDeleted: number;
}

/**
 * Deletes storage nobody references (plan §9 "cleanup of orphaned uploads"):
 * - temporary uploads older than 24 hours (finalize never ran)
 * - public variants older than 24 hours whose photo row is gone (a failed delete or insert)
 * - avatar variants older than 24 hours that no lister profile points at (prompt lister-avatars)
 * S9 calls this from a QStash job. `referencedBaseKeys` / `referencedAvatarKeys` return which base
 * keys are still in use.
 */
export async function sweepOrphans(args: {
  publicStore: ObjectStore;
  privateStore: ObjectStore;
  referencedBaseKeys: (baseKeys: string[]) => Promise<Set<string>>;
  referencedAvatarKeys: (baseKeys: string[]) => Promise<Set<string>>;
  now?: Date;
}): Promise<SweepResult> {
  const cutoff = (args.now ?? new Date()).getTime() - ORPHAN_AGE_MS;
  const isOld = (lastModified: Date) => lastModified.getTime() < cutoff;

  const staleUploads = (await args.privateStore.list(UPLOADS_PREFIX)).filter((o) => isOld(o.lastModified));
  await args.privateStore.delete(staleUploads.map((o) => o.key));

  /** Deletes old public variants under `prefix` whose base key is no longer referenced. */
  async function sweepPublic(
    prefix: string,
    baseKeyOf: (key: string) => string | null,
    referencedKeys: (baseKeys: string[]) => Promise<Set<string>>,
  ): Promise<number> {
    const oldVariants = (await args.publicStore.list(prefix)).filter((o) => isOld(o.lastModified));
    const baseKeys = [...new Set(oldVariants.map((o) => baseKeyOf(o.key)).filter((k): k is string => k !== null))];
    const referenced = baseKeys.length > 0 ? await referencedKeys(baseKeys) : new Set<string>();
    const orphaned = oldVariants.filter((o) => {
      const base = baseKeyOf(o.key);
      return base !== null && !referenced.has(base);
    });
    await args.publicStore.delete(orphaned.map((o) => o.key));
    return orphaned.length;
  }

  const imagesDeleted = await sweepPublic(LISTINGS_PREFIX, baseKeyOfVariant, args.referencedBaseKeys);
  const avatarsDeleted = await sweepPublic(AVATARS_PREFIX, baseKeyOfAvatarVariant, args.referencedAvatarKeys);
  return { uploadsDeleted: staleUploads.length, imagesDeleted, avatarsDeleted };
}
