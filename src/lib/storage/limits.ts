/**
 * Photo limits and variant sizes (prompt S4 decisions 3 and 4). Client-safe: the upload UI shows
 * the same numbers the server enforces.
 */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_LISTING = 20;
export const MIN_PHOTO_WIDTH = 800;
export const MIN_PHOTO_HEIGHT = 600;
export const MAX_INPUT_PIXELS = 40_000_000;
export const PRESIGN_SECONDS = 5 * 60;
export const PHOTO_ALT_MIN = 5;
export const PHOTO_ALT_MAX = 200;
/** Listings with this many photos meet the featured quality bar (plan §5); shown as a tip only. */
export const FEATURED_PHOTO_COUNT = 5;

/** WebP widths written for every photo, smallest first. */
export const VARIANT_WIDTHS = [480, 960, 1600] as const;
export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

export function isImageMime(value: string): value is ImageMime {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** The smallest stored variant that covers `width`, capped at the largest. */
export function variantFor(width: number): VariantWidth {
  return VARIANT_WIDTHS.find((w) => w >= width) ?? VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
}

/** File name suffix of a variant, appended to an image's base key or base URL. */
export function variantSuffix(width: VariantWidth): string {
  return `-${width}.webp`;
}
