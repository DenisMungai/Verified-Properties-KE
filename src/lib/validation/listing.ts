import { z } from "zod";
import { AMENITIES, COMMERCIAL_SUBTYPES, KENYA_COUNTIES } from "@/lib/kenya";

/**
 * Listing validation (plan v2.0 §9; prompt S3 decisions 2–3). Two levels:
 *  - step schemas (Basics, Details) accept an incomplete draft but never an invalid value, and
 *    always satisfy the database checks;
 *  - `parseListing` runs on the stored listing at submit time and reports every problem at once.
 * Only the keys named here are ever read, so status, owner, agency or slug fields in a forged form
 * never reach the output.
 */

export const LISTING_TYPES = ["sale", "rent"] as const;
export const CATEGORIES = ["house", "apartment", "land", "commercial"] as const;
export const RENT_PERIODS = ["month", "week", "year"] as const;
export const LAND_UNITS = ["acre", "hectare", "sqm"] as const;

export type ListingTypeValue = (typeof LISTING_TYPES)[number];
export type Category = (typeof CATEGORIES)[number];
export type RentPeriod = (typeof RENT_PERIODS)[number];
export type LandUnit = (typeof LAND_UNITS)[number];

export const LISTING_TYPE_LABELS: Record<ListingTypeValue, string> = { sale: "For sale", rent: "For rent" };
export const CATEGORY_LABELS: Record<Category, string> = {
  house: "House",
  apartment: "Apartment",
  land: "Land",
  commercial: "Commercial",
};
export const RENT_PERIOD_LABELS: Record<RentPeriod, string> = { month: "Per month", week: "Per week", year: "Per year" };
export const LAND_UNIT_LABELS: Record<LandUnit, string> = { acre: "Acres", hectare: "Hectares", sqm: "Square metres" };

/** Highest accepted price: KSh 100 billion. */
export const MAX_PRICE_KES = 100_000_000_000;
export const TITLE_MIN = 10;
export const TITLE_MAX = 120;
export const DESCRIPTION_MIN = 30;
export const DESCRIPTION_MAX = 4000;

/** Every editable listing field, as stored. */
export interface ListingFields {
  title: string;
  listingType: ListingTypeValue;
  category: Category;
  county: string;
  town: string;
  neighbourhood: string | null;
  priceKes: number;
  rentPeriod: RentPeriod | null;
  bedrooms: number | null;
  description: string;
  bathrooms: number | null;
  areaSqm: number | null;
  landSize: number | null;
  landSizeUnit: LandUnit | null;
  furnished: boolean;
  parkingSpaces: number | null;
  amenities: string[];
  subtype: string | null;
  zoningNotes: string | null;
}

export const BASICS_FIELDS = [
  "title",
  "listingType",
  "category",
  "county",
  "town",
  "neighbourhood",
  "priceKes",
  "rentPeriod",
  "bedrooms",
] as const;
export const DETAILS_FIELDS = [
  "description",
  "bathrooms",
  "areaSqm",
  "landSize",
  "landSizeUnit",
  "furnished",
  "parkingSpaces",
  "amenities",
  "subtype",
  "zoningNotes",
] as const;

export type BasicsInput = Pick<ListingFields, (typeof BASICS_FIELDS)[number]>;
export type DetailsInput = Pick<ListingFields, (typeof DETAILS_FIELDS)[number]>;
export type ListingStep = "basics" | "details";

/** Which step fixes a field, for the preview checklist. */
export function stepForField(field: string): ListingStep {
  return (BASICS_FIELDS as readonly string[]).includes(field) ? "basics" : "details";
}

/* -------------------------------------------------------------------------- */
/* Form value helpers                                                         */
/* -------------------------------------------------------------------------- */

const blank = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/** "8,500,000" or "8 500 000" -> 8500000; blanks become undefined. */
function toNumber(value: unknown): unknown {
  const b = blank(value);
  if (typeof b !== "string") return b;
  return Number(b.replace(/[,\s]/g, ""));
}

const optionalText = (max: number, message: string) =>
  z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(max, { error: message })
      .optional()
      .transform((v) => v ?? null),
  );

const optionalInt = (min: number, max: number, message: string) =>
  z.preprocess(
    toNumber,
    z
      .number({ error: message })
      .int({ error: message })
      .min(min, { error: message })
      .max(max, { error: message })
      .optional()
      .transform((v) => v ?? null),
  );

const optionalDecimal = (min: number, max: number, message: string) =>
  z.preprocess(
    toNumber,
    z
      .number({ error: message })
      .min(min, { error: message })
      .max(max, { error: message })
      .optional()
      .transform((v) => v ?? null),
  );

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.preprocess(
    blank,
    z
      .enum(values, { error: message })
      .optional()
      .transform((v) => v ?? null),
  );

const priceSchema = z.preprocess(
  toNumber,
  z
    .number({ error: "Enter the price in shillings, for example 8,500,000." })
    .int({ error: "Enter a whole number of shillings, without cents." })
    .positive({ error: "The price must be more than KSh 0." })
    .max(MAX_PRICE_KES, { error: "That price is too high. Check the number of zeros." }),
);

const isHalfStep = (n: number) => Number.isInteger(n * 2);

/* -------------------------------------------------------------------------- */
/* Step schemas (drafts)                                                      */
/* -------------------------------------------------------------------------- */

export const basicsSchema = z
  .object({
    title: z
      .string({ error: "Give your listing a title." })
      .trim()
      .min(1, { error: "Give your listing a title." })
      .max(TITLE_MAX, { error: `Use ${TITLE_MAX} characters or fewer.` }),
    listingType: z.enum(LISTING_TYPES, { error: "Choose For sale or For rent." }),
    category: z.enum(CATEGORIES, { error: "Choose a property category." }),
    county: z.enum(KENYA_COUNTIES, { error: "Choose a county." }),
    town: z
      .string({ error: "Enter the town, for example Nairobi or Ruiru." })
      .trim()
      .min(2, { error: "Enter the town, for example Nairobi or Ruiru." })
      .max(60, { error: "Use 60 characters or fewer." }),
    neighbourhood: optionalText(60, "Use 60 characters or fewer."),
    priceKes: priceSchema,
    rentPeriod: optionalEnum(RENT_PERIODS, "Choose how often rent is paid."),
    bedrooms: optionalInt(0, 50, "Enter 0 to 50 bedrooms (0 for a studio)."),
  })
  .superRefine((data, ctx) => {
    // The database requires a rent period on every rent listing, drafts included.
    if (data.listingType === "rent" && !data.rentPeriod) {
      ctx.addIssue({ code: "custom", path: ["rentPeriod"], message: "Choose how often rent is paid." });
    }
  });

export const detailsSchema = z
  .object({
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX, { error: `Use ${DESCRIPTION_MAX.toLocaleString("en-KE")} characters or fewer.` })
      .default(""),
    bathrooms: optionalDecimal(0, 50, "Enter 0 to 50 bathrooms.").refine((v) => v === null || isHalfStep(v), {
      error: "Use whole or half numbers, for example 2 or 2.5.",
    }),
    areaSqm: optionalDecimal(1, 10_000_000, "Enter the built area in square metres."),
    landSize: optionalDecimal(0.01, 1_000_000, "Enter the land size, for example 0.25."),
    landSizeUnit: optionalEnum(LAND_UNITS, "Choose a unit."),
    furnished: z.boolean().default(false),
    parkingSpaces: optionalInt(0, 100, "Enter 0 to 100 parking spaces."),
    amenities: z
      .array(z.enum(AMENITIES, { error: "Choose amenities from the list." }))
      .default([])
      .transform((list) => [...new Set(list)]),
    subtype: optionalEnum(COMMERCIAL_SUBTYPES, "Choose the kind of commercial property."),
    zoningNotes: optionalText(1000, "Use 1,000 characters or fewer."),
  })
  .superRefine((data, ctx) => {
    // The database requires land size and unit together.
    if (data.landSize !== null && data.landSizeUnit === null) {
      ctx.addIssue({ code: "custom", path: ["landSizeUnit"], message: "Choose a unit." });
    }
    if (data.landSize === null && data.landSizeUnit !== null) {
      ctx.addIssue({ code: "custom", path: ["landSize"], message: "Enter the land size, or clear the unit." });
    }
  });

export type StepResult<T> = { success: true; data: T } | { success: false; errors: Record<string, string> };

function firstErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";

/**
 * Zod skips an object's cross-field refinements when any single field is invalid. These parsers
 * add the cross-field rules from the raw input in that case, so every problem shows at once.
 */
export function parseBasicsStep(raw: Record<string, string>): StepResult<BasicsInput> {
  const result = basicsSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const errors = firstErrors(result.error);
  if (raw.listingType === "rent" && !filled(raw.rentPeriod)) errors.rentPeriod ??= "Choose how often rent is paid.";
  return { success: false, errors };
}

export function parseDetailsStep(raw: ReturnType<typeof detailsFormValues>): StepResult<DetailsInput> {
  const result = detailsSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const errors = firstErrors(result.error);
  if (filled(raw.landSize) && !filled(raw.landSizeUnit)) errors.landSizeUnit ??= "Choose a unit.";
  if (!filled(raw.landSize) && filled(raw.landSizeUnit)) errors.landSize ??= "Enter the land size, or clear the unit.";
  return { success: false, errors };
}

/* -------------------------------------------------------------------------- */
/* Category rules                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Nulls fields that do not apply to the category or listing type (no bedrooms on land, no rent
 * period on a sale), so stored data is consistent with the database checks after any edit.
 */
export function normalizeForCategory(fields: ListingFields): ListingFields {
  const isLand = fields.category === "land";
  const isHome = fields.category === "house" || fields.category === "apartment";
  const isCommercial = fields.category === "commercial";
  return {
    ...fields,
    rentPeriod: fields.listingType === "rent" ? fields.rentPeriod : null,
    bedrooms: isHome ? fields.bedrooms : null,
    bathrooms: isHome ? fields.bathrooms : null,
    areaSqm: isLand ? null : fields.areaSqm,
    landSize: isLand ? fields.landSize : null,
    landSizeUnit: isLand ? fields.landSizeUnit : null,
    furnished: isLand ? false : fields.furnished,
    parkingSpaces: isLand ? null : fields.parkingSpaces,
    amenities: isLand ? [] : fields.amenities,
    subtype: isCommercial ? fields.subtype : null,
    zoningNotes: isCommercial ? fields.zoningNotes : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Submit check                                                               */
/* -------------------------------------------------------------------------- */

export type ParseListingResult = { success: true; data: ListingFields } | { success: false; errors: Record<string, string> };

/**
 * Everything a listing needs before it can be submitted, checked on the stored row. Reports every
 * problem at once (field rules and category rules together), keyed by form field name.
 */
export function parseListing(fields: ListingFields): ParseListingResult {
  const errors: Record<string, string> = {};
  const add = (field: string, message: string) => {
    errors[field] ??= message;
  };
  const title = fields.title.trim();
  const description = fields.description.trim();

  if (title.length < TITLE_MIN) add("title", `Use at least ${TITLE_MIN} characters for the title.`);
  if (title.length > TITLE_MAX) add("title", `Use ${TITLE_MAX} characters or fewer.`);
  if (description.length < DESCRIPTION_MIN) {
    add("description", `Describe the property in at least ${DESCRIPTION_MIN} characters.`);
  }
  if (description.length > DESCRIPTION_MAX) {
    add("description", `Use ${DESCRIPTION_MAX.toLocaleString("en-KE")} characters or fewer.`);
  }
  if (!Number.isInteger(fields.priceKes) || fields.priceKes <= 0) add("priceKes", "Enter a price above KSh 0.");
  if (fields.town.trim().length < 2) add("town", "Enter the town, for example Nairobi or Ruiru.");

  const isHome = fields.category === "house" || fields.category === "apartment";
  if (fields.listingType === "rent" && !fields.rentPeriod) add("rentPeriod", "Choose how often rent is paid.");
  if (isHome && fields.bedrooms === null) add("bedrooms", "Enter the number of bedrooms (0 for a studio).");
  if (isHome && fields.bathrooms === null) add("bathrooms", "Enter the number of bathrooms.");
  if (fields.category === "land") {
    if (fields.landSize === null) add("landSize", "Enter the land size.");
    if (fields.landSizeUnit === null) add("landSizeUnit", "Choose a unit for the land size.");
  }
  if (fields.category === "commercial" && !fields.subtype) {
    add("subtype", "Choose the kind of commercial property.");
  }

  return Object.keys(errors).length === 0
    ? { success: true, data: normalizeForCategory({ ...fields, title, description }) }
    : { success: false, errors };
}

/** Plain-language labels for the preview checklist. */
export const FIELD_LABELS: Record<keyof ListingFields, string> = {
  title: "Title",
  listingType: "Listing type",
  category: "Property category",
  county: "County",
  town: "Town",
  neighbourhood: "Area / neighbourhood",
  priceKes: "Price",
  rentPeriod: "Rent period",
  bedrooms: "Bedrooms",
  description: "Description",
  bathrooms: "Bathrooms",
  areaSqm: "Built area",
  landSize: "Land size",
  landSizeUnit: "Land size unit",
  furnished: "Furnished",
  parkingSpaces: "Parking spaces",
  amenities: "Amenities",
  subtype: "Commercial type",
  zoningNotes: "Zoning notes",
};

/* -------------------------------------------------------------------------- */
/* Form readers                                                               */
/* -------------------------------------------------------------------------- */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The Basics fields from a form post, as strings (nothing else is read). */
export function basicsFormValues(formData: FormData): Record<(typeof BASICS_FIELDS)[number], string> {
  return Object.fromEntries(BASICS_FIELDS.map((name) => [name, text(formData, name)])) as Record<
    (typeof BASICS_FIELDS)[number],
    string
  >;
}

/** The Details fields from a form post (nothing else is read). */
export function detailsFormValues(formData: FormData) {
  return {
    description: text(formData, "description"),
    bathrooms: text(formData, "bathrooms"),
    areaSqm: text(formData, "areaSqm"),
    landSize: text(formData, "landSize"),
    landSizeUnit: text(formData, "landSizeUnit"),
    furnished: formData.get("furnished") === "1",
    parkingSpaces: text(formData, "parkingSpaces"),
    amenities: formData.getAll("amenities").filter((v): v is string => typeof v === "string"),
    subtype: text(formData, "subtype"),
    zoningNotes: text(formData, "zoningNotes"),
  };
}

/** Details values flattened to strings so a form can be re-filled after an error. */
export function detailsValuesForState(values: ReturnType<typeof detailsFormValues>): Record<string, string> {
  return {
    ...values,
    furnished: values.furnished ? "1" : "",
    amenities: values.amenities.join("|"),
  };
}
