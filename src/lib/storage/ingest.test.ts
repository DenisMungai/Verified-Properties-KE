import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@/test/memory-store";
import { REJECT_MESSAGES } from "./image-processing";
import { deleteAvatarObjects, deleteImageObjects, ingestAvatarUpload, ingestUpload, UploadError } from "./ingest";
import { avatarVariantKeys, newAvatarUploadKey, newUploadKey, variantKeys } from "./keys";

const listingId = "6e3207db-4285-46de-bc83-152f69563115";

async function setup(body: Buffer) {
  const privateStore = createMemoryStore();
  const publicStore = createMemoryStore();
  const uploadKey = newUploadKey("u_owner", listingId);
  await privateStore.put(uploadKey, body, "image/jpeg");
  return { privateStore, publicStore, uploadKey };
}

const photo = () =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background: "#14833B" } })
    .jpeg()
    .toBuffer();

describe("ingestUpload", () => {
  it("writes three public WebP variants and deletes the temporary upload", async () => {
    const { privateStore, publicStore, uploadKey } = await setup(await photo());
    const result = await ingestUpload({ privateStore, publicStore, userId: "u_owner", listingId, uploadKey });

    expect(result).toMatchObject({ width: 1200, height: 900 });
    expect([...publicStore.objects.keys()].sort()).toEqual(variantKeys(result.baseKey).sort());
    for (const object of publicStore.objects.values()) expect(object.contentType).toBe("image/webp");
    expect(privateStore.objects.size).toBe(0);
  });

  it("still deletes the temporary upload when the file is rejected", async () => {
    const { privateStore, publicStore, uploadKey } = await setup(Buffer.from("text renamed to photo.jpg"));
    await expect(
      ingestUpload({ privateStore, publicStore, userId: "u_owner", listingId, uploadKey }),
    ).rejects.toEqual(new UploadError(REJECT_MESSAGES.type));
    expect(privateStore.objects.size).toBe(0);
    expect(publicStore.objects.size).toBe(0);
  });

  it("refuses another user's upload key and leaves it untouched", async () => {
    const { privateStore, publicStore, uploadKey } = await setup(await photo());
    await expect(
      ingestUpload({ privateStore, publicStore, userId: "u_stranger", listingId, uploadKey }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(privateStore.objects.has(uploadKey)).toBe(true);
    expect(publicStore.objects.size).toBe(0);
  });

  it("reports a missing or oversized upload in plain words", async () => {
    const { privateStore, publicStore } = await setup(await photo());
    const missing = newUploadKey("u_owner", listingId);
    await expect(
      ingestUpload({ privateStore, publicStore, userId: "u_owner", listingId, uploadKey: missing }),
    ).rejects.toThrow("We did not receive that photo");

    const big = await setup(Buffer.alloc(8 * 1024 * 1024 + 1));
    await expect(
      ingestUpload({ ...big, userId: "u_owner", listingId }),
    ).rejects.toEqual(new UploadError(REJECT_MESSAGES.size));
    expect(big.privateStore.objects.size).toBe(0);
  });

  it("deleteImageObjects removes every variant", async () => {
    const { privateStore, publicStore, uploadKey } = await setup(await photo());
    const { baseKey } = await ingestUpload({ privateStore, publicStore, userId: "u_owner", listingId, uploadKey });
    await deleteImageObjects(publicStore, baseKey);
    expect(publicStore.objects.size).toBe(0);
  });
});

describe("ingestAvatarUpload", () => {
  async function avatarSetup(body: Buffer, owner = "u_owner") {
    const privateStore = createMemoryStore();
    const publicStore = createMemoryStore();
    const uploadKey = newAvatarUploadKey(owner);
    await privateStore.put(uploadKey, body, "image/jpeg");
    return { privateStore, publicStore, uploadKey };
  }

  it("writes the square variants under the user's avatars and deletes the upload", async () => {
    const { privateStore, publicStore, uploadKey } = await avatarSetup(await photo());
    const baseKey = await ingestAvatarUpload({ privateStore, publicStore, userId: "u_owner", uploadKey });
    expect(baseKey).toMatch(/^avatars\/u_owner\//);
    expect([...publicStore.objects.keys()].sort()).toEqual(avatarVariantKeys(baseKey).sort());
    expect(privateStore.objects.size).toBe(0);
    await deleteAvatarObjects(publicStore, baseKey);
    expect(publicStore.objects.size).toBe(0);
  });

  it("refuses another user's key and listing upload keys", async () => {
    const { privateStore, publicStore, uploadKey } = await avatarSetup(await photo());
    await expect(ingestAvatarUpload({ privateStore, publicStore, userId: "u_stranger", uploadKey })).rejects.toBeInstanceOf(UploadError);
    const listingKey = newUploadKey("u_owner", listingId);
    await expect(ingestAvatarUpload({ privateStore, publicStore, userId: "u_owner", uploadKey: listingKey })).rejects.toBeInstanceOf(UploadError);
    expect(privateStore.objects.has(uploadKey)).toBe(true);
    expect(publicStore.objects.size).toBe(0);
  });

  it("deletes the upload when the image is too small", async () => {
    const small = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#14833B" } }).png().toBuffer();
    const { privateStore, publicStore, uploadKey } = await avatarSetup(small);
    await expect(ingestAvatarUpload({ privateStore, publicStore, userId: "u_owner", uploadKey })).rejects.toEqual(
      new UploadError(REJECT_MESSAGES.avatarDimensions),
    );
    expect(privateStore.objects.size).toBe(0);
    expect(publicStore.objects.size).toBe(0);
  });
});
