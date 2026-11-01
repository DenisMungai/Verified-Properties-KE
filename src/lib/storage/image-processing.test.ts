import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectImageType, ImageRejectedError, processAvatar, processImage, REJECT_MESSAGES } from "./image-processing";

function canvas(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 131, b: 59 } } });
}

const jpeg = (w: number, h: number) => canvas(w, h).jpeg().toBuffer();
const png = (w: number, h: number) => canvas(w, h).png().toBuffer();
const webp = (w: number, h: number) => canvas(w, h).webp().toBuffer();

async function rejection(input: Uint8Array): Promise<string> {
  try {
    await processImage(input);
  } catch (error) {
    if (error instanceof ImageRejectedError) return error.reason;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("detectImageType", () => {
  it("recognises JPEG, PNG and WebP from their bytes", async () => {
    expect(detectImageType(await jpeg(10, 10))).toBe("jpeg");
    expect(detectImageType(await png(10, 10))).toBe("png");
    expect(detectImageType(await webp(10, 10))).toBe("webp");
  });

  it("rejects GIF, PDF, text and empty input whatever their name", async () => {
    const gif = await canvas(10, 10).gif().toBuffer();
    expect(detectImageType(gif)).toBeNull();
    expect(detectImageType(Buffer.from("%PDF-1.7\n"))).toBeNull();
    expect(detectImageType(Buffer.from("just some text pretending to be a .jpg"))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});

describe("processImage", () => {
  it("writes three WebP variants without enlarging", async () => {
    const out = await processImage(await jpeg(1200, 900));
    expect(out.variants.map((v) => v.width)).toEqual([480, 960, 1600]);
    expect(out.variants.map((v) => v.pixelWidth)).toEqual([480, 960, 1200]);
    for (const variant of out.variants) expect(detectImageType(variant.body)).toBe("webp");
    expect({ width: out.width, height: out.height }).toEqual({ width: 1200, height: 900 });
  });

  it("scales large photos down to 1600 on the long side", async () => {
    const out = await processImage(await png(3200, 2400));
    expect({ width: out.width, height: out.height }).toEqual({ width: 1600, height: 1200 });
  });

  it("applies the EXIF orientation and strips EXIF, including GPS", async () => {
    const input = await canvas(1000, 800)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: "Owner name" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "1/1 17/1 0/1" } })
      .toBuffer();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.toString("latin1")).toContain("Owner name");

    const out = await processImage(input);
    expect({ width: out.width, height: out.height }).toEqual({ width: 800, height: 1000 });
    for (const variant of out.variants) {
      const meta = await sharp(variant.body).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }
  });

  it("rejects photos below 800 × 600, the wrong type and corrupt files", async () => {
    expect(await rejection(await jpeg(799, 600))).toBe(REJECT_MESSAGES.dimensions);
    expect(await rejection(await jpeg(800, 599))).toBe(REJECT_MESSAGES.dimensions);
    expect(await rejection(Buffer.from("not an image at all"))).toBe(REJECT_MESSAGES.type);
    const truncated = (await jpeg(1200, 900)).subarray(0, 200);
    expect(await rejection(truncated)).toBe(REJECT_MESSAGES.unreadable);
  });
});

describe("processAvatar", () => {
  it("writes 128 and 384 WebP squares, centre-cropped from a wide photo", async () => {
    const variants = await processAvatar(await jpeg(1000, 600));
    expect(variants.map((v) => v.size)).toEqual([128, 384]);
    for (const variant of variants) {
      expect(detectImageType(variant.body)).toBe("webp");
      const meta = await sharp(variant.body).metadata();
      expect({ width: meta.width, height: meta.height }).toEqual({ width: variant.size, height: variant.size });
      expect(meta.exif).toBeUndefined();
    }
  });

  it("rejects images under 200 × 200 on either side, the wrong type and corrupt files", async () => {
    const avatarRejection = async (input: Uint8Array) => processAvatar(input).then(
      () => "accepted",
      (error: unknown) => (error instanceof ImageRejectedError ? error.reason : "other"),
    );
    expect(await avatarRejection(await png(150, 150))).toBe(REJECT_MESSAGES.avatarDimensions);
    expect(await avatarRejection(await png(800, 199))).toBe(REJECT_MESSAGES.avatarDimensions);
    expect(await avatarRejection(Buffer.from("%PDF-1.7\n"))).toBe(REJECT_MESSAGES.type);
    expect(await avatarRejection((await jpeg(400, 400)).subarray(0, 200))).toBe(REJECT_MESSAGES.unreadable);
    expect(await avatarRejection(await webp(200, 200))).toBe("accepted");
  });
});
