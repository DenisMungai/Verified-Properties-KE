import "server-only";
import sharp from "sharp";
import {
  MAX_INPUT_PIXELS,
  MIN_PHOTO_HEIGHT,
  MIN_PHOTO_WIDTH,
  VARIANT_WIDTHS,
  type VariantWidth,
} from "./limits";

export type DetectedType = "jpeg" | "png" | "webp";

/** The real file type from its first bytes. The declared Content-Type and file name are ignored. */
export function detectImageType(buf: Uint8Array): DetectedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((byte, i) => buf[i] === byte)) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

export class ImageRejectedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "ImageRejectedError";
  }
}

export const REJECT_MESSAGES = {
  type: "Upload a JPEG, PNG or WebP photo.",
  size: "Photos must be 8 MB or smaller.",
  dimensions: `Photos must be at least ${MIN_PHOTO_WIDTH} × ${MIN_PHOTO_HEIGHT} pixels.`,
  unreadable: "That image could not be read. Try exporting it as a JPEG.",
} as const;

export interface ProcessedVariant {
  width: VariantWidth;
  body: Buffer;
  pixelWidth: number;
  pixelHeight: number;
}

export interface ProcessedImage {
  variants: ProcessedVariant[];
  /** Size of the largest variant, stored on the image row. */
  width: number;
  height: number;
}

/**
 * Decodes, applies the EXIF orientation, then re-encodes every variant as WebP. Re-encoding drops
 * all metadata (GPS, camera, owner) and neutralises polyglot or malformed files. Variants are
 * never enlarged.
 */
export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  if (!detectImageType(input)) throw new ImageRejectedError(REJECT_MESSAGES.type);
  try {
    const source = sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const meta = await source.metadata();
    // rotate() is applied on output; orientations 5-8 swap width and height.
    const swapped = (meta.orientation ?? 1) >= 5;
    const width = swapped ? meta.height : meta.width;
    const height = swapped ? meta.width : meta.height;
    if (!width || !height) throw new ImageRejectedError(REJECT_MESSAGES.unreadable);
    if (width < MIN_PHOTO_WIDTH || height < MIN_PHOTO_HEIGHT) throw new ImageRejectedError(REJECT_MESSAGES.dimensions);

    const variants: ProcessedVariant[] = [];
    for (const target of VARIANT_WIDTHS) {
      const { data, info } = await source
        .clone()
        .resize({ width: target, height: target, fit: "inside", withoutEnlargement: true })
        .webp({ quality: target === 480 ? 75 : 80 })
        .toBuffer({ resolveWithObject: true });
      variants.push({ width: target, body: data, pixelWidth: info.width, pixelHeight: info.height });
    }
    const largest = variants[variants.length - 1];
    return { variants, width: largest.pixelWidth, height: largest.pixelHeight };
  } catch (error) {
    if (error instanceof ImageRejectedError) throw error;
    throw new ImageRejectedError(REJECT_MESSAGES.unreadable);
  }
}
