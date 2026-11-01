import { describe, expect, it } from "vitest";
import {
  avatarVariantKeys,
  baseKeyOfAvatarVariant,
  baseKeyOfVariant,
  isOwnAvatarUploadKey,
  isOwnUploadKey,
  newAvatarBaseKey,
  newAvatarUploadKey,
  newImageBaseKey,
  newUploadKey,
  uploadKeyPrefix,
  variantKeys,
} from "./keys";
import { avatarVariantFor, variantFor, VARIANT_WIDTHS } from "./limits";

const listing = "6e3207db-4285-46de-bc83-152f69563115";
const otherListing = "b09ad41b-6d59-4120-a640-1a10676b6006";

describe("upload keys", () => {
  it("are scoped to the user and listing and pass the ownership check", () => {
    const key = newUploadKey("u_owner", listing);
    expect(key).toMatch(new RegExp(`^uploads/u_owner/${listing}/[0-9a-f-]{36}$`));
    expect(isOwnUploadKey(key, "u_owner", listing)).toBe(true);
  });

  it("reject other users, other listings, traversal and arbitrary objects", () => {
    const key = newUploadKey("u_owner", listing);
    expect(isOwnUploadKey(key, "u_stranger", listing)).toBe(false);
    expect(isOwnUploadKey(key, "u_owner", otherListing)).toBe(false);
    expect(isOwnUploadKey(`${uploadKeyPrefix("u_owner", listing)}../../verification/doc`, "u_owner", listing)).toBe(false);
    expect(isOwnUploadKey(`${uploadKeyPrefix("u_owner", listing)}not-a-uuid`, "u_owner", listing)).toBe(false);
    expect(isOwnUploadKey("verification/u_owner/passport.pdf", "u_owner", listing)).toBe(false);
  });

  it("refuse unsafe segments instead of building a key", () => {
    expect(() => uploadKeyPrefix("../admin", listing)).toThrow();
    expect(() => uploadKeyPrefix("u_owner", "not-a-uuid")).toThrow();
    expect(isOwnUploadKey("uploads/../x", "../", listing)).toBe(false);
  });
});

describe("image keys", () => {
  it("have one variant per width and map back to their base key", () => {
    const base = newImageBaseKey(listing);
    expect(base).toMatch(new RegExp(`^listings/${listing}/[0-9a-f-]{36}$`));
    const keys = variantKeys(base);
    expect(keys).toEqual(VARIANT_WIDTHS.map((w) => `${base}-${w}.webp`));
    for (const key of keys) expect(baseKeyOfVariant(key)).toBe(base);
    expect(baseKeyOfVariant(`uploads/u/${listing}/x`)).toBeNull();
  });
});

describe("variantFor", () => {
  it("picks the smallest variant that covers the width, capped at the largest", () => {
    expect(variantFor(16)).toBe(480);
    expect(variantFor(480)).toBe(480);
    expect(variantFor(481)).toBe(960);
    expect(variantFor(960)).toBe(960);
    expect(variantFor(1200)).toBe(1600);
    expect(variantFor(3840)).toBe(1600);
  });
});

describe("avatar keys", () => {
  it("scope uploads to the user and never pass the listing upload check", () => {
    const key = newAvatarUploadKey("u_owner");
    expect(key).toMatch(/^uploads\/u_owner\/avatar\/[0-9a-f-]{36}$/);
    expect(isOwnAvatarUploadKey(key, "u_owner")).toBe(true);
    expect(isOwnAvatarUploadKey(key, "u_stranger")).toBe(false);
    expect(isOwnAvatarUploadKey(newUploadKey("u_owner", listing), "u_owner")).toBe(false);
    expect(isOwnAvatarUploadKey("uploads/u_owner/avatar/../../x", "u_owner")).toBe(false);
    expect(isOwnAvatarUploadKey(key, "../")).toBe(false);
    expect(() => newAvatarUploadKey("../admin")).toThrow();
  });

  it("have a 128 and a 384 variant that map back to their base key", () => {
    const base = newAvatarBaseKey("u_owner");
    expect(base).toMatch(/^avatars\/u_owner\/[0-9a-f-]{36}$/);
    const keys = avatarVariantKeys(base);
    expect(keys).toEqual([`${base}-128.webp`, `${base}-384.webp`]);
    for (const key of keys) expect(baseKeyOfAvatarVariant(key)).toBe(base);
    expect(baseKeyOfAvatarVariant(`${base}-480.webp`)).toBeNull();
    expect(baseKeyOfAvatarVariant(`listings/${listing}/${listing}-480.webp`)).toBeNull();
    expect(() => newAvatarBaseKey("a/b")).toThrow();
  });

  it("avatarVariantFor picks 128 up to 128px and 384 above", () => {
    expect(avatarVariantFor(20)).toBe(128);
    expect(avatarVariantFor(128)).toBe(128);
    expect(avatarVariantFor(129)).toBe(384);
    expect(avatarVariantFor(2000)).toBe(384);
  });
});
