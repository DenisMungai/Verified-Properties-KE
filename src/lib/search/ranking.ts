import { NAIROBI_TIME_ZONE } from "@/lib/format";
import { FEATURED_PHOTO_COUNT } from "@/lib/storage/limits";

/**
 * Ranking constants (plan v2.0 §5; prompt S7 decisions 1, 2, 7 and 9). The SQL that uses them
 * lives in `src/db/queries/ranking.ts`; nothing here decides who is verified.
 */

/** Recommended score = match + recency + quality, each part in [0, 1]. Weights sum to 1. */
export const SCORE_WEIGHTS = { match: 0.35, recency: 0.35, quality: 0.3 } as const;

/** Recency = 1 / (1 + days since published / RECENCY_DAYS). */
export const RECENCY_DAYS = 14;

/** Quality = PHOTO_SHARE × min(photos, PHOTO_TARGET) / PHOTO_TARGET + (1 − PHOTO_SHARE) × completeness. */
export const PHOTO_TARGET = 8;
export const PHOTO_SHARE = 0.6;
/** A description counts towards completeness from this length. */
export const COMPLETE_DESCRIPTION_CHARS = 200;

/** Verified listings with scores in the same bucket rotate daily. */
export const SCORE_BUCKET = 0.1;

/** At most LISTER_CAP listings per lister (an agency counts as one) in the first CAP_WINDOW. */
export const LISTER_CAP = 3;
export const CAP_WINDOW = 20;

/** "Verified listers" strip above Newest and Price results, page 1 only. */
export const VERIFIED_STRIP_SIZE = 3;

/** Home page listings section: two full rows of the 4-column home grid. */
export const HOME_SLOTS = 8;
export const HOME_PER_LISTER = 2;
export const FEATURED_MIN_PHOTOS = FEATURED_PHOTO_COUNT;

const seedFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NAIROBI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The daily rotation seed: the Nairobi calendar date, e.g. "2026-10-30". */
export function nairobiDateSeed(now: Date): string {
  return seedFormatter.format(now);
}
