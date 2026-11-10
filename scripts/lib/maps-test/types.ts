/** Shared types for the S18 map provider test (prompt s18-map-provider-test.md). */

export type ProviderId = "google" | "mapbox";

/** Shared result precision, finest first. */
export type Precision =
  | "poi"
  | "address"
  | "street"
  | "neighbourhood"
  | "locality"
  | "city"
  | "county"
  | "country"
  | "unknown";

export type LocationGroup =
  | "Nairobi estates"
  | "Landmarks"
  | "Satellite towns"
  | "Mombasa"
  | "Kisumu"
  | "Nakuru";

export interface TestLocation {
  id: number;
  /** As a lister would type it. */
  query: string;
  neighbourhood: string;
  aliases: readonly string[];
  town: string;
  county: string;
  group: LocationGroup;
}

export type ReferenceSource = "osm" | "manual" | "none";

export interface ReferencePoint {
  id: number;
  source: ReferenceSource;
  lat: number | null;
  lng: number | null;
  /** e.g. "way/123456"; null for manual or none. */
  osmId: string | null;
  /** Nominatim addresstype, or the reason a point was rejected. */
  type: string | null;
  note?: string;
}

/** A provider answer reduced to what scoring needs. Held in memory only (amendment A2). */
export interface GeocodeAnswer {
  lat: number;
  lng: number;
  precision: Precision;
  /** Name, full address and component names joined, for name matching. */
  text: string;
}

export interface Suggestion {
  /** Full suggestion text (main + secondary). */
  text: string;
}

/** Derived per-request outcome; the only thing cached (amendment A2). No provider content. */
export interface GeocodeOutcome {
  found: boolean;
  precision: Precision | null;
  distanceKm: number | null;
  inKenya: boolean;
  neighbourhoodNamed: boolean;
  townNamed: boolean;
}

export interface AutocompleteOutcome {
  /** 1-based rank of the first matching suggestion in the top 5, or null. */
  rank: number | null;
  suggestionCount: number;
}

export type HitLevel = "neighbourhood" | "town" | "miss";

/** 0–2 per criterion, judged by eye from the static images. */
export interface TileJudgement {
  labels: number;
  roads: number;
  buildings: number;
  legibility: number;
  note?: string;
}

export interface PriceTier {
  /** Inclusive upper bound of monthly volume for this tier; Infinity for the last tier. */
  upTo: number;
  /** USD per 1,000 events in this tier; 0 for a free tier. */
  usdPer1000: number;
}
