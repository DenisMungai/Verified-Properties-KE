import { describe, expect, it } from "vitest";
import { fieldErrorsFrom } from "@/lib/action-state";
import {
  basicsFormValues,
  basicsSchema,
  detailsFormValues,
  detailsSchema,
  normalizeForCategory,
  parseBasicsStep,
  parseDetailsStep,
  parseListing,
  stepForField,
  type ListingFields,
} from "./listing";

const basics = {
  title: "Modern 3-bedroom apartment in Kilimani",
  listingType: "rent",
  category: "apartment",
  county: "Nairobi",
  town: "Nairobi",
  neighbourhood: "Kilimani",
  priceKes: "85,000",
  rentPeriod: "month",
  bedrooms: "3",
};

const complete: ListingFields = {
  title: "Modern 3-bedroom apartment in Kilimani",
  listingType: "rent",
  category: "apartment",
  county: "Nairobi",
  town: "Nairobi",
  neighbourhood: "Kilimani",
  priceKes: 85_000,
  rentPeriod: "month",
  bedrooms: 3,
  description: "Bright corner unit with a balcony, lift, backup generator and parking.",
  bathrooms: 2,
  areaSqm: 140,
  landSize: null,
  landSizeUnit: null,
  furnished: false,
  parkingSpaces: 1,
  amenities: ["Lift"],
  subtype: null,
  zoningNotes: null,
};

describe("basicsSchema", () => {
  it("parses a complete Basics step, accepting comma prices", () => {
    const result = basicsSchema.parse(basics);
    expect(result.priceKes).toBe(85_000);
    expect(result.bedrooms).toBe(3);
    expect(result.neighbourhood).toBe("Kilimani");
  });

  it("accepts a draft with optional fields blank", () => {
    const result = basicsSchema.parse({ ...basics, listingType: "sale", rentPeriod: "", neighbourhood: "", bedrooms: "" });
    expect(result.rentPeriod).toBeNull();
    expect(result.neighbourhood).toBeNull();
    expect(result.bedrooms).toBeNull();
  });

  it("rejects invalid values even in a draft", () => {
    const result = basicsSchema.safeParse({ ...basics, priceKes: "-5", county: "Atlantis", bedrooms: "2.5" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = fieldErrorsFrom(result.error);
    expect(Object.keys(errors).sort()).toEqual(["bedrooms", "county", "priceKes"]);
  });

  it("rejects cents and missing prices", () => {
    expect(basicsSchema.safeParse({ ...basics, priceKes: "85000.50" }).success).toBe(false);
    expect(basicsSchema.safeParse({ ...basics, priceKes: "" }).success).toBe(false);
    expect(basicsSchema.safeParse({ ...basics, priceKes: "abc" }).success).toBe(false);
  });

  it("requires a rent period on rent listings, as the database does", () => {
    const result = basicsSchema.safeParse({ ...basics, rentPeriod: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrorsFrom(result.error)).toHaveProperty("rentPeriod");
  });

  it("reports the missing rent period alongside other errors", () => {
    const result = parseBasicsStep({ ...basics, rentPeriod: "", priceKes: "" });
    expect(result).toMatchObject({ success: false });
    if (!result.success) expect(Object.keys(result.errors).sort()).toEqual(["priceKes", "rentPeriod"]);
  });
});

describe("detailsSchema", () => {
  const details = {
    description: "",
    bathrooms: "2.5",
    areaSqm: "",
    landSize: "",
    landSizeUnit: "",
    furnished: true,
    parkingSpaces: "",
    amenities: ["Lift", "Lift", "Gym"],
    subtype: "",
    zoningNotes: "",
  };

  it("accepts an empty description in a draft and de-duplicates amenities", () => {
    const result = detailsSchema.parse(details);
    expect(result.description).toBe("");
    expect(result.bathrooms).toBe(2.5);
    expect(result.amenities).toEqual(["Lift", "Gym"]);
  });

  it("reports quarter bathrooms, unknown amenities and a land size without a unit together", () => {
    const result = parseDetailsStep({
      ...details,
      bathrooms: "1.25",
      amenities: ["Helipad"],
      landSize: "0.5",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(result.errors).sort()).toEqual(["amenities", "bathrooms", "landSizeUnit"]);
  });

  it("flags a lone land size or unit when everything else is valid", () => {
    const result = parseDetailsStep({ ...details, landSizeUnit: "acre" });
    expect(result).toMatchObject({ success: false, errors: { landSize: expect.any(String) } });
  });
});

describe("normalizeForCategory", () => {
  it("clears home fields on land and land fields on homes", () => {
    const land = normalizeForCategory({ ...complete, category: "land", landSize: 0.5, landSizeUnit: "acre" });
    expect(land).toMatchObject({ bedrooms: null, bathrooms: null, areaSqm: null, furnished: false, amenities: [] });
    expect(land.landSize).toBe(0.5);
    const home = normalizeForCategory({ ...complete, landSize: 0.5, landSizeUnit: "acre" });
    expect(home).toMatchObject({ landSize: null, landSizeUnit: null });
  });

  it("drops the rent period on sales and commercial fields elsewhere", () => {
    const result = normalizeForCategory({ ...complete, listingType: "sale", subtype: "Office", zoningNotes: "x" });
    expect(result).toMatchObject({ rentPeriod: null, subtype: null, zoningNotes: null });
  });
});

describe("parseListing (submit)", () => {
  it("accepts a complete listing", () => {
    expect(parseListing(complete)).toMatchObject({ success: true });
  });

  it("reports every missing item at once, keyed by field", () => {
    const result = parseListing({
      ...complete,
      title: "Flat",
      description: "",
      bathrooms: null,
      bedrooms: null,
      rentPeriod: null,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(result.errors).sort()).toEqual(["bathrooms", "bedrooms", "description", "rentPeriod", "title"]);
  });

  it("applies the land and commercial rules", () => {
    const land = parseListing({ ...complete, listingType: "sale", rentPeriod: null, category: "land" });
    expect(land.success).toBe(false);
    if (!land.success) expect(Object.keys(land.errors).sort()).toEqual(["landSize", "landSizeUnit"]);

    const commercial = parseListing({ ...complete, category: "commercial" });
    expect(commercial.success).toBe(false);
    if (!commercial.success) expect(Object.keys(commercial.errors)).toEqual(["subtype"]);
  });

  it("maps fields to the step that fixes them", () => {
    expect(stepForField("bedrooms")).toBe("basics");
    expect(stepForField("description")).toBe("details");
  });
});

describe("form readers", () => {
  it("read only listing fields, so forged protected fields are ignored", () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(basics)) formData.set(key, value);
    formData.set("status", "published");
    formData.set("ownerUserId", "someone-else");
    formData.set("agencyId", "x");
    const values = basicsFormValues(formData);
    expect(values).not.toHaveProperty("status");
    expect(values).not.toHaveProperty("ownerUserId");
    const parsed = basicsSchema.parse(values);
    expect(parsed).not.toHaveProperty("status");
  });

  it("reads checkboxes and multi-value amenities", () => {
    const formData = new FormData();
    formData.set("furnished", "1");
    formData.append("amenities", "Lift");
    formData.append("amenities", "Gym");
    const values = detailsFormValues(formData);
    expect(values.furnished).toBe(true);
    expect(values.amenities).toEqual(["Lift", "Gym"]);
  });
});
