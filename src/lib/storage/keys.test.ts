import { describe, expect, it } from "vitest";
import { baseKeyOfVariant, isOwnUploadKey, newImageBaseKey, newUploadKey, uploadKeyPrefix, variantKeys } from "./keys";
import { variantFor, VARIANT_WIDTHS } from "./limits";

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
