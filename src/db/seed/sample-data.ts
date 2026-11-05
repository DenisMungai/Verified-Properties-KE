import type { ListingFields } from "@/lib/validation/listing";

/**
 * SAMPLE data for `npm run db:seed` (prompt S11 decisions 3 and 6). Every item says it is a
 * sample: user ids start with `sample-`, emails use the reserved `example.test` domain, names end
 * in "(sample)", titles start with "Sample: ", descriptions end with the sample note and photo alt
 * text starts with "Sample photo:". Sample listers have no phone or public email: any made-up
 * number could belong to a real person.
 *
 * Verified status is never stored here as a flag: `verified: true` tells the seed to create a real
 * verification request and a paid verification subscription, and the `verified_listers_now` view
 * derives the badge from those rows like for anyone else.
 */

export const SAMPLE_ID_PREFIX = "sample-";
export const SAMPLE_EMAIL_DOMAIN = "example.test";
export const SAMPLE_NAME_SUFFIX = " (sample)";
export const SAMPLE_TITLE_PREFIX = "Sample: ";
export const SAMPLE_NOTE = "SAMPLE DATA: this is not a real property listing.";
export const SAMPLE_ALT_PREFIX = "Sample photo: ";
export const SAMPLE_RECEIPT_PREFIX = "SAMPLE";
export const SAMPLE_DECISION_REASON = "SAMPLE: seeded for demonstration";
export const SAMPLE_REJECTION_REASON = "SAMPLE: seeded rejected listing for the never-public check.";
/** Stored on every sample payment as its `raw_callback`. */
export const SAMPLE_PAYMENT_MARKER = { sample: true, source: "db:seed" } as const;

export type SampleListingPlan = "starter" | "pro";
export type SampleStatus = "published" | "draft" | "pending_review" | "rejected";

/** Files in scripts/seed-assets/ (without `.webp`). */
export type SampleAsset =
  | "commercial-office"
  | "kilimani-apartments"
  | "nairobi-townhouse"
  | "runda-four-bedroom-house"
  | "vacant-land"
  | "villa-bedroom"
  | "villa-front"
  | "villa-garden-view"
  | "villa-kitchen"
  | "villa-living-room"
  | "villa-pool";

export type SampleAvatar = "agent-man-01" | "agent-man-02" | "agent-woman-01" | "agent-woman-02";

export interface SampleLister {
  /** Appended to the id prefix: `sample-agent-wanjiru`. */
  key: string;
  displayName: string;
  listerType: "agent" | "owner";
  listingPlan: SampleListingPlan;
  verified: boolean;
  avatar: SampleAvatar;
  bio: string;
}

export interface SampleListing {
  /** Appended to the id prefix to make the slug: `sample-kilimani-2br-apartment`. */
  key: string;
  lister: string;
  status: SampleStatus;
  /** Days before the seed runs that it was published (or last changed, for hidden listings). */
  ageDays: number;
  fields: ListingFields;
  /** Neighbourhood centre, never an exact address. */
  publicPoint: { latitude: number; longitude: number };
  photos: SampleAsset[];
}

export const SAMPLE_LISTERS: SampleLister[] = [
  {
    key: "agent-wanjiru",
    displayName: `Wanjiru Kamau${SAMPLE_NAME_SUFFIX}`,
    listerType: "agent",
    listingPlan: "pro",
    verified: true,
    avatar: "agent-woman-01",
    bio: "Sample agent profile for demonstration. Not a real person or agency.",
  },
  {
    key: "agent-otieno",
    displayName: `Brian Otieno${SAMPLE_NAME_SUFFIX}`,
    listerType: "agent",
    listingPlan: "pro",
    verified: true,
    avatar: "agent-man-01",
    bio: "Sample agent profile for demonstration. Not a real person or agency.",
  },
  {
    key: "agent-njoroge",
    displayName: `Peter Njoroge${SAMPLE_NAME_SUFFIX}`,
    listerType: "agent",
    listingPlan: "pro",
    verified: false,
    avatar: "agent-man-02",
    bio: "Sample agent profile for demonstration. Not a real person or agency.",
  },
  {
    key: "owner-achieng",
    displayName: `Grace Achieng${SAMPLE_NAME_SUFFIX}`,
    listerType: "owner",
    listingPlan: "starter",
    verified: false,
    avatar: "agent-woman-02",
    bio: "Sample owner profile for demonstration. Not a real person.",
  },
];

export const PHOTO_ALT: Record<SampleAsset, string> = {
  "commercial-office": "glass-fronted office building on a tree-lined street",
  "kilimani-apartments": "modern apartment block with balconies and a landscaped lawn",
  "nairobi-townhouse": "townhouse with a stone facade and a front garden",
  "runda-four-bedroom-house": "two-storey family home with a paved driveway",
  "vacant-land": "open green plot with a dirt access road and hills behind",
  "villa-bedroom": "bedroom with a large bed and a balcony door",
  "villa-front": "front of a house with a paved driveway and palm trees",
  "villa-garden-view": "rear of a house with a terrace and a lawn",
  "villa-kitchen": "kitchen with a wooden island, bar stools and pendant lights",
  "villa-living-room": "bright living room with a cream sofa and garden views",
  "villa-pool": "swimming pool and sun loungers beside a house",
};

/** Alt text for a sample photo: always starts with "Sample photo:". */
export function sampleAlt(asset: SampleAsset): string {
  return `${SAMPLE_ALT_PREFIX}${PHOTO_ALT[asset]}`;
}

function describe(text: string): string {
  return `${text} ${SAMPLE_NOTE}`;
}

const NO_EXTRAS = {
  rentPeriod: null,
  bedrooms: null,
  bathrooms: null,
  areaSqm: null,
  landSize: null,
  landSizeUnit: null,
  furnished: false,
  parkingSpaces: null,
  amenities: [],
  subtype: null,
  zoningNotes: null,
  neighbourhood: null,
} satisfies Partial<ListingFields>;

type Fields = Partial<ListingFields> &
  Pick<ListingFields, "title" | "listingType" | "category" | "county" | "town" | "priceKes" | "description">;

function fields(f: Fields): ListingFields {
  return { ...NO_EXTRAS, ...f, title: `${SAMPLE_TITLE_PREFIX}${f.title}`, description: describe(f.description) };
}

export const SAMPLE_LISTINGS: SampleListing[] = [
  /* ------------------------------ Wanjiru (verified) ------------------------------ */
  {
    key: "kilimani-2br-apartment",
    lister: "agent-wanjiru",
    status: "published",
    ageDays: 1,
    publicPoint: { latitude: -1.2921, longitude: 36.7836 },
    photos: ["kilimani-apartments", "villa-living-room", "villa-kitchen", "villa-bedroom", "villa-pool"],
    fields: fields({
      title: "Bright 2-bedroom apartment in Kilimani",
      listingType: "rent",
      category: "apartment",
      county: "Nairobi",
      town: "Nairobi",
      neighbourhood: "Kilimani",
      priceKes: 85_000,
      rentPeriod: "month",
      bedrooms: 2,
      bathrooms: 2,
      areaSqm: 98,
      furnished: true,
      parkingSpaces: 1,
      amenities: ["Gym", "Backup generator", "24-hour security"],
      description:
        "A furnished two-bedroom apartment on a quiet street, close to Yaya Centre, schools and matatu routes. Both bedrooms are en suite and the living room opens onto a balcony.",
    }),
  },
  {
    key: "westlands-3br-apartment",
    lister: "agent-wanjiru",
    status: "published",
    ageDays: 2,
    publicPoint: { latitude: -1.2676, longitude: 36.8108 },
    photos: ["kilimani-apartments", "villa-living-room", "villa-bedroom"],
    fields: fields({
      title: "3-bedroom apartment with city views, Westlands",
      listingType: "sale",
      category: "apartment",
      county: "Nairobi",
      town: "Nairobi",
      neighbourhood: "Westlands",
      priceKes: 18_500_000,
      bedrooms: 3,
      bathrooms: 3,
      areaSqm: 165,
      parkingSpaces: 2,
      amenities: ["Swimming pool", "Lift", "CCTV"],
      description:
        "A spacious three-bedroom apartment on a high floor with views over the city. The building has a rooftop pool, two lifts and round-the-clock security.",
    }),
  },
  {
    key: "karen-4br-house",
    lister: "agent-wanjiru",
    status: "published",
    ageDays: 3,
    publicPoint: { latitude: -1.3197, longitude: 36.7073 },
    photos: ["villa-front", "villa-garden-view", "villa-pool", "villa-living-room", "villa-kitchen", "villa-bedroom"],
    fields: fields({
      title: "4-bedroom house on a quiet Karen lane",
      listingType: "sale",
      category: "house",
      county: "Nairobi",
      town: "Nairobi",
      neighbourhood: "Karen",
      priceKes: 62_000_000,
      bedrooms: 4,
      bathrooms: 4,
      areaSqm: 380,
      parkingSpaces: 3,
      amenities: ["Garden", "Borehole", "Servant quarters", "Swimming pool"],
      description:
        "A four-bedroom family house on half an acre with a mature garden, a pool and a borehole. The lane is quiet and close to Karen shopping centre.",
    }),
  },
  {
    key: "runda-5br-house-rent",
    lister: "agent-wanjiru",
    status: "published",
    ageDays: 4,
    publicPoint: { latitude: -1.218, longitude: 36.807 },
    photos: ["runda-four-bedroom-house", "villa-garden-view", "villa-kitchen", "villa-living-room", "villa-bedroom"],
    fields: fields({
      title: "5-bedroom family home to let, Runda",
      listingType: "rent",
      category: "house",
      county: "Nairobi",
      town: "Nairobi",
      neighbourhood: "Runda",
      priceKes: 320_000,
      rentPeriod: "month",
      bedrooms: 5,
      bathrooms: 5,
      areaSqm: 450,
      parkingSpaces: 4,
      amenities: ["Garden", "Solar water heating", "Gated community"],
      description:
        "A five-bedroom home in a gated estate with a large garden, solar water heating and parking for four cars. Close to international schools.",
    }),
  },
  {
    key: "upper-hill-office",
    lister: "agent-wanjiru",
    status: "published",
    ageDays: 6,
    publicPoint: { latitude: -1.299, longitude: 36.815 },
    photos: ["commercial-office"],
    fields: fields({
      title: "Open-plan office floor, Upper Hill",
      listingType: "rent",
      category: "commercial",
      subtype: "Office",
      county: "Nairobi",
      town: "Nairobi",
      neighbourhood: "Upper Hill",
      priceKes: 280_000,
      rentPeriod: "month",
      areaSqm: 320,
      parkingSpaces: 6,
      amenities: ["Lift", "Backup generator", "Fibre internet"],
      description:
        "A 320 square metre open-plan office floor in a modern block with fibre internet, a backup generator and six parking bays.",
    }),
  },
  {
    key: "industrial-area-warehouse",
    lister: "agent-wanjiru",
    status: "published",
    ageDays: 8,
    publicPoint: { latitude: -1.306, longitude: 36.851 },
    photos: ["commercial-office"],
    fields: fields({
      title: "Warehouse with loading bays, Industrial Area",
      listingType: "rent",
      category: "commercial",
      subtype: "Warehouse",
      county: "Nairobi",
      town: "Nairobi",
      neighbourhood: "Industrial Area",
      priceKes: 450_000,
      rentPeriod: "month",
      areaSqm: 1200,
      parkingSpaces: 10,
      zoningNotes: "Light industrial and storage use, as stated by the lister.",
      amenities: ["Loading bays", "24-hour security"],
      description:
        "A 1,200 square metre warehouse with three loading bays, a mezzanine office and secure yard parking, a short drive from the CBD.",
    }),
  },

  /* ------------------------------ Otieno (verified) ------------------------------- */
  {
    key: "mombasa-nyali-3br",
    lister: "agent-otieno",
    status: "published",
    ageDays: 2,
    publicPoint: { latitude: -4.0435, longitude: 39.709 },
    photos: ["villa-pool", "villa-bedroom", "villa-living-room", "villa-kitchen", "villa-garden-view"],
    fields: fields({
      title: "Sea-view 3-bedroom apartment, Nyali",
      listingType: "rent",
      category: "apartment",
      county: "Mombasa",
      town: "Mombasa",
      neighbourhood: "Nyali",
      priceKes: 120_000,
      rentPeriod: "month",
      bedrooms: 3,
      bathrooms: 3,
      areaSqm: 150,
      furnished: true,
      parkingSpaces: 2,
      amenities: ["Swimming pool", "Gym", "Sea view"],
      description:
        "A furnished three-bedroom apartment with sea views, a shared pool and gym, a few minutes from Nyali beach and City Mall.",
    }),
  },
  {
    key: "mombasa-bamburi-2br",
    lister: "agent-otieno",
    status: "published",
    ageDays: 5,
    publicPoint: { latitude: -3.996, longitude: 39.723 },
    photos: ["kilimani-apartments", "villa-living-room", "villa-bedroom"],
    fields: fields({
      title: "2-bedroom flat for sale, Bamburi",
      listingType: "sale",
      category: "apartment",
      county: "Mombasa",
      town: "Mombasa",
      neighbourhood: "Bamburi",
      priceKes: 6_200_000,
      bedrooms: 2,
      bathrooms: 2,
      areaSqm: 85,
      parkingSpaces: 1,
      amenities: ["Parking", "Borehole"],
      description:
        "A two-bedroom flat in a small, well-kept block near Bamburi beach, with a borehole and one parking space.",
    }),
  },
  {
    key: "nakuru-10-acres",
    lister: "agent-otieno",
    status: "published",
    ageDays: 9,
    publicPoint: { latitude: -0.3031, longitude: 36.08 },
    photos: ["vacant-land"],
    fields: fields({
      title: "10 acres of farmland, Nakuru",
      listingType: "sale",
      category: "land",
      county: "Nakuru",
      town: "Nakuru",
      priceKes: 45_000_000,
      landSize: 10,
      landSizeUnit: "acre",
      description:
        "Ten acres of fertile, gently sloping farmland with road access and power nearby, suitable for mixed farming.",
    }),
  },
  {
    key: "nakuru-shop-for-sale",
    lister: "agent-otieno",
    status: "published",
    ageDays: 12,
    publicPoint: { latitude: -0.2827, longitude: 36.0664 },
    photos: ["commercial-office"],
    fields: fields({
      title: "Ground-floor shop for sale, Nakuru CBD",
      listingType: "sale",
      category: "commercial",
      subtype: "Retail",
      county: "Nakuru",
      town: "Nakuru",
      neighbourhood: "CBD",
      priceKes: 14_000_000,
      areaSqm: 75,
      description:
        "A 75 square metre ground-floor shop on a busy street in Nakuru town, with a glass frontage and a small store room.",
    }),
  },

  /* ------------------------------ Njoroge (unverified) ---------------------------- */
  {
    key: "thika-3br-maisonette",
    lister: "agent-njoroge",
    status: "published",
    ageDays: 7,
    publicPoint: { latitude: -1.0333, longitude: 37.0693 },
    photos: ["nairobi-townhouse", "villa-living-room"],
    fields: fields({
      title: "3-bedroom maisonette in a gated estate, Thika",
      listingType: "sale",
      category: "house",
      subtype: null,
      county: "Kiambu",
      town: "Thika",
      priceKes: 9_800_000,
      bedrooms: 3,
      bathrooms: 3,
      areaSqm: 140,
      parkingSpaces: 2,
      amenities: ["Gated community", "Borehole"],
      description:
        "A three-bedroom maisonette in a gated estate with a borehole, a small garden and parking for two cars, close to Thika Road.",
    }),
  },
  {
    key: "ruiru-half-acre-plot",
    lister: "agent-njoroge",
    status: "published",
    ageDays: 10,
    publicPoint: { latitude: -1.1466, longitude: 36.9609 },
    photos: ["vacant-land"],
    fields: fields({
      title: "Half-acre residential plot, Ruiru",
      listingType: "sale",
      category: "land",
      county: "Kiambu",
      town: "Ruiru",
      priceKes: 7_500_000,
      landSize: 0.5,
      landSizeUnit: "acre",
      description: "A half-acre residential plot on a murram road with water and power on site, near Ruiru town.",
    }),
  },
  {
    key: "machakos-3br-bungalow",
    lister: "agent-njoroge",
    status: "published",
    ageDays: 15,
    publicPoint: { latitude: -1.5177, longitude: 37.2634 },
    photos: ["nairobi-townhouse", "villa-front"],
    fields: fields({
      title: "3-bedroom bungalow on a large plot, Machakos",
      listingType: "sale",
      category: "house",
      county: "Machakos",
      town: "Machakos",
      priceKes: 11_500_000,
      bedrooms: 3,
      bathrooms: 2,
      areaSqm: 160,
      parkingSpaces: 2,
      amenities: ["Garden", "Borehole"],
      description:
        "A three-bedroom bungalow on a quarter-acre plot with a borehole and a large garden, ten minutes from Machakos town.",
    }),
  },
  {
    key: "draft-listing",
    lister: "agent-njoroge",
    status: "draft",
    ageDays: 1,
    publicPoint: { latitude: -1.2921, longitude: 36.8219 },
    photos: ["nairobi-townhouse"],
    fields: fields({
      title: "DRAFT, should never appear publicly",
      listingType: "sale",
      category: "house",
      county: "Nairobi",
      town: "Nairobi",
      priceKes: 5_000_000,
      bedrooms: 2,
      bathrooms: 1,
      description: "A draft listing used to check that drafts never reach search, the home page or a detail page.",
    }),
  },

  /* ------------------------------ Achieng (owner, Starter) ------------------------ */
  {
    key: "juja-bedsitter",
    lister: "owner-achieng",
    status: "published",
    ageDays: 3,
    publicPoint: { latitude: -1.1022, longitude: 37.0144 },
    photos: ["kilimani-apartments"],
    fields: fields({
      title: "Affordable bedsitter near Juja town",
      listingType: "rent",
      category: "apartment",
      county: "Kiambu",
      town: "Juja",
      priceKes: 6_500,
      rentPeriod: "month",
      bedrooms: 0,
      bathrooms: 1,
      areaSqm: 20,
      amenities: ["Water included"],
      description: "A clean bedsitter with water included, a short walk from Juja town and the university.",
    }),
  },
  {
    key: "kitengela-eighth-acre",
    lister: "owner-achieng",
    status: "published",
    ageDays: 11,
    publicPoint: { latitude: -1.474, longitude: 36.962 },
    photos: ["vacant-land"],
    fields: fields({
      title: "Eighth-acre plot with title deed, Kitengela",
      listingType: "sale",
      category: "land",
      county: "Kajiado",
      town: "Kitengela",
      priceKes: 1_800_000,
      landSize: 0.125,
      landSizeUnit: "acre",
      description: "An eighth-acre plot in a growing residential area of Kitengela, with a title deed and road access.",
    }),
  },
  {
    key: "pending-listing",
    lister: "owner-achieng",
    status: "pending_review",
    ageDays: 1,
    publicPoint: { latitude: -1.2921, longitude: 36.8219 },
    photos: ["kilimani-apartments"],
    fields: fields({
      title: "PENDING REVIEW, should never appear publicly",
      listingType: "rent",
      category: "apartment",
      county: "Nairobi",
      town: "Nairobi",
      priceKes: 40_000,
      rentPeriod: "month",
      bedrooms: 1,
      bathrooms: 1,
      description: "A listing waiting for review, used to check that it never reaches search, the home page or a detail page.",
    }),
  },
  {
    key: "rejected-listing",
    lister: "owner-achieng",
    status: "rejected",
    ageDays: 2,
    publicPoint: { latitude: -1.474, longitude: 36.962 },
    photos: ["vacant-land"],
    fields: fields({
      title: "REJECTED, should never appear publicly",
      listingType: "sale",
      category: "land",
      county: "Kajiado",
      town: "Kitengela",
      priceKes: 900_000,
      landSize: 1,
      landSizeUnit: "acre",
      description: "A rejected listing, used to check that it never reaches search, the home page or a detail page.",
    }),
  },
];

/** Every asset the seed reads, photos and avatars. */
export function sampleAssets(): { photos: SampleAsset[]; avatars: SampleAvatar[] } {
  return {
    photos: [...new Set(SAMPLE_LISTINGS.flatMap((listing) => listing.photos))],
    avatars: [...new Set(SAMPLE_LISTERS.map((lister) => lister.avatar))],
  };
}
