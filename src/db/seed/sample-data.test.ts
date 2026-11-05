import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AMENITIES, COMMERCIAL_SUBTYPES, KENYA_COUNTIES } from "@/lib/kenya";
import { photoAltSchema, normalizeForCategory, parseSubmission } from "@/lib/validation/listing";
import {
  SAMPLE_ALT_PREFIX,
  SAMPLE_ID_PREFIX,
  SAMPLE_LISTERS,
  SAMPLE_LISTINGS,
  SAMPLE_NAME_SUFFIX,
  SAMPLE_NOTE,
  SAMPLE_TITLE_PREFIX,
  sampleAlt,
  sampleAssets,
} from "./sample-data";
import { SANDBOX_PLANS } from "./sandbox-plans";
import { activeListingCount, sampleSlug } from "./seed";

const listerKeys = new Set(SAMPLE_LISTERS.map((lister) => lister.key));

describe("sample data", () => {
  it.each(SAMPLE_LISTINGS.map((listing) => [listing.key, listing] as const))("%s passes the submit checks", (_key, listing) => {
    const result = parseSubmission(listing.fields, { count: listing.photos.length, hasCover: listing.photos.length > 0 });
    expect(result).toEqual({ success: true, data: listing.fields });
    // No field that doesn't apply to the category is stored.
    expect(normalizeForCategory(listing.fields)).toEqual(listing.fields);
  });

  it("uses only reference data from kenya.ts", () => {
    for (const { fields } of SAMPLE_LISTINGS) {
      expect(KENYA_COUNTIES).toContain(fields.county);
      for (const amenity of fields.amenities) expect(AMENITIES).toContain(amenity);
      if (fields.subtype !== null) expect(COMMERCIAL_SUBTYPES).toContain(fields.subtype);
      expect(fields.listingType === "rent").toBe(fields.rentPeriod !== null);
      expect(fields.landSize === null).toBe(fields.landSizeUnit === null);
    }
  });

  it("labels everything as a sample", () => {
    for (const lister of SAMPLE_LISTERS) expect(lister.displayName.endsWith(SAMPLE_NAME_SUFFIX)).toBe(true);
    for (const listing of SAMPLE_LISTINGS) {
      expect(listing.fields.title.startsWith(SAMPLE_TITLE_PREFIX)).toBe(true);
      expect(listing.fields.description.endsWith(SAMPLE_NOTE)).toBe(true);
      for (const asset of listing.photos) {
        expect(sampleAlt(asset).startsWith(SAMPLE_ALT_PREFIX)).toBe(true);
        expect(photoAltSchema.safeParse(sampleAlt(asset)).success).toBe(true);
      }
    }
  });

  it("gives every listing a unique sample slug and a known lister", () => {
    const slugs = SAMPLE_LISTINGS.map((listing) => sampleSlug(SAMPLE_ID_PREFIX, listing));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^sample-[a-z0-9-]+$/);
    for (const listing of SAMPLE_LISTINGS) expect(listerKeys.has(listing.lister)).toBe(true);
  });

  it("has 15 published listings and the three never-public ones", () => {
    expect(SAMPLE_LISTINGS.filter((l) => l.status === "published")).toHaveLength(15);
    const hidden = SAMPLE_LISTINGS.filter((l) => l.status !== "published");
    expect(hidden.map((l) => l.status).sort()).toEqual(["draft", "pending_review", "rejected"]);
    for (const listing of hidden) expect(listing.fields.title).toContain("should never appear publicly");
  });

  it("keeps every lister within their plan's listing limit", () => {
    for (const lister of SAMPLE_LISTERS) {
      const plan = SANDBOX_PLANS.find((p) => p.code === lister.listingPlan);
      expect(plan?.listingLimit).toBeTypeOf("number");
      expect(activeListingCount(lister.key)).toBeLessThanOrEqual(plan!.listingLimit!);
    }
  });

  it("has two verified listers whose home listings meet the featured photo bar", () => {
    const verified = SAMPLE_LISTERS.filter((lister) => lister.verified).map((lister) => lister.key);
    expect(verified).toEqual(["agent-wanjiru", "agent-otieno"]);
    for (const key of verified) {
      expect(SAMPLE_LISTINGS.some((l) => l.lister === key && l.status === "published" && l.photos.length >= 5)).toBe(true);
    }
  });

  it("never stores contact details or exact locations", () => {
    for (const lister of SAMPLE_LISTERS) {
      expect(lister).not.toHaveProperty("phone");
      expect(lister).not.toHaveProperty("publicEmail");
    }
    for (const listing of SAMPLE_LISTINGS) {
      expect(Object.keys(listing.publicPoint).sort()).toEqual(["latitude", "longitude"]);
    }
  });

  it("finds every asset in scripts/seed-assets", () => {
    const { photos, avatars } = sampleAssets();
    for (const name of [...photos, ...avatars]) {
      expect(existsSync(path.join(process.cwd(), "scripts", "seed-assets", `${name}.webp`))).toBe(true);
    }
  });
});
