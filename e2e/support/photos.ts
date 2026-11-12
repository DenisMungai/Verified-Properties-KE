/**
 * Listing photos for the journey. The seed assets are smaller than the 800 × 600 minimum, so the
 * suite draws its own 1200 × 800 JPEGs (plain colour fields with a gradient band) with sharp.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { E2E_DATA_DIR } from "./env";

const COLOURS = [
  { r: 20, g: 131, b: 59 },
  { r: 8, g: 116, b: 67 },
  { r: 180, g: 140, b: 90 },
  { r: 90, g: 120, b: 160 },
  { r: 200, g: 200, b: 190 },
];

export async function makeListingPhotos(count: number): Promise<string[]> {
  const dir = path.join(E2E_DATA_DIR, "photos");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `e2e-photo-${i + 1}.jpg`);
    const band = Buffer.from(
      `<svg width="1200" height="800"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity="0.1"/><stop offset="1" stop-color="#fff" stop-opacity="0.6"/></linearGradient></defs><rect y="${120 * (i + 1)}" width="1200" height="160" fill="url(#g)"/></svg>`,
    );
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: COLOURS[i % COLOURS.length] } })
      .composite([{ input: band }])
      .jpeg({ quality: 80 })
      .toFile(file);
    files.push(file);
  }
  return files;
}
