import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@/test/memory-store";
import { ORPHAN_AGE_MS, sweepOrphans } from "./cleanup";
import { avatarVariantKeys, variantKeys } from "./keys";

const now = new Date("2026-10-29T12:00:00Z");
const old = new Date(now.getTime() - ORPHAN_AGE_MS - 1);
const recent = new Date(now.getTime() - 60_000);
const listing = "6e3207db-4285-46de-bc83-152f69563115";
const kept = `listings/${listing}/11111111-1111-4111-8111-111111111111`;
const orphan = `listings/${listing}/22222222-2222-4222-8222-222222222222`;
const fresh = `listings/${listing}/33333333-3333-4333-8333-333333333333`;

function seed(store: ReturnType<typeof createMemoryStore>, key: string, lastModified: Date) {
  store.objects.set(key, { body: Buffer.from("x"), contentType: "image/webp", lastModified });
}

describe("sweepOrphans", () => {
  it("deletes only old uploads and old variants with no photo row", async () => {
    const privateStore = createMemoryStore();
    const publicStore = createMemoryStore();
    seed(privateStore, `uploads/u_owner/${listing}/aaaa`, old);
    seed(privateStore, `uploads/u_owner/${listing}/bbbb`, recent);
    seed(privateStore, "verification/u_owner/doc", old);
    for (const key of variantKeys(kept)) seed(publicStore, key, old);
    for (const key of variantKeys(orphan)) seed(publicStore, key, old);
    for (const key of variantKeys(fresh)) seed(publicStore, key, recent);

    const asked: string[][] = [];
    const result = await sweepOrphans({
      privateStore,
      publicStore,
      now,
      referencedBaseKeys: async (keys) => {
        asked.push(keys);
        return new Set(keys.filter((key) => key === kept));
      },
      referencedAvatarKeys: async () => new Set(),
    });

    expect(result).toEqual({ uploadsDeleted: 1, imagesDeleted: 3, avatarsDeleted: 0 });
    expect([...privateStore.objects.keys()].sort()).toEqual([`uploads/u_owner/${listing}/bbbb`, "verification/u_owner/doc"]);
    expect([...publicStore.objects.keys()].sort()).toEqual([...variantKeys(kept), ...variantKeys(fresh)].sort());
    expect(asked).toEqual([[kept, orphan]]);
  });

  it("deletes old avatars no profile points at and keeps the current and recent ones", async () => {
    const privateStore = createMemoryStore();
    const publicStore = createMemoryStore();
    const current = "avatars/u_owner/44444444-4444-4444-8444-444444444444";
    const replaced = "avatars/u_owner/55555555-5555-4555-8555-555555555555";
    const justUploaded = "avatars/u_owner/66666666-6666-4666-8666-666666666666";
    seed(privateStore, "uploads/u_owner/avatar/cccc", old);
    for (const key of avatarVariantKeys(current)) seed(publicStore, key, old);
    for (const key of avatarVariantKeys(replaced)) seed(publicStore, key, old);
    for (const key of avatarVariantKeys(justUploaded)) seed(publicStore, key, recent);

    const result = await sweepOrphans({
      privateStore,
      publicStore,
      now,
      referencedBaseKeys: async () => new Set(),
      referencedAvatarKeys: async (keys) => new Set(keys.filter((key) => key === current)),
    });

    expect(result).toEqual({ uploadsDeleted: 1, imagesDeleted: 0, avatarsDeleted: 2 });
    expect([...privateStore.objects.keys()]).toEqual([]);
    expect([...publicStore.objects.keys()].sort()).toEqual([...avatarVariantKeys(current), ...avatarVariantKeys(justUploaded)].sort());
  });
});
