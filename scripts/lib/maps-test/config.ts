/**
 * Every tunable number of the S18 provider test in one place (prompt decisions 5–10, A5).
 * Edit the traffic block to model a different launch.
 */
import type { PriceTier } from "./types";

/** Default launch traffic per month (decision 8). The report also shows 3×. */
export const TRAFFIC = {
  mapViews: 30_000,
  autocompleteSessions: 20_000,
  geocodes: 2_000,
  /** Debounced keystroke requests per autocomplete session, for per-request pricing (A5). */
  requestsPerSession: 6,
} as const;

export const GROWTH_MULTIPLIER = 3;

/** Weighted score out of 100 (decision 9). */
export const WEIGHTS = { autocomplete: 35, geocoding: 35, cost: 20, tiles: 10 } as const;

/** A split must beat the best single provider by this many points (decision 9). */
export const SPLIT_MARGIN = 5;

/** Geocoding thresholds in km (decision 5). */
export const NEIGHBOURHOOD_KM = 2;
export const TOWN_KM = 8;

/** Disagreement flag (decision 4). */
export const PROVIDERS_AGREE_KM = 1;
export const REFERENCE_DISAGREE_KM = 2;

export const AUTOCOMPLETE_TOP_N = 5;
export const SHORT_PREFIX = 4;
export const LONG_PREFIX = 7;

/** Budget safety (decision 10). */
export const MAX_BILLABLE_PER_PROVIDER = 300;
export const PROVIDER_MIN_INTERVAL_MS = 200; // ≤ 5 requests per second
export const NOMINATIM_MIN_INTERVAL_MS = 1_100; // ≤ 1 request per second
export const REQUEST_TIMEOUT_MS = 10_000;

export const TILE_SIZE = { width: 600, height: 400 } as const;

export const USER_AGENT = "VerifiedPropertiesKE-provider-test/1.0";

/** Local, gitignored working folder (decision 11). */
export const WORK_DIR = ".provider-test";

const free = (upTo: number): PriceTier => ({ upTo, usdPer1000: 0 });
const tier = (upTo: number, usdPer1000: number): PriceTier => ({ upTo, usdPer1000 });

export interface PriceSource {
  url: string;
  checked: string;
  note?: string;
}

export const PRICING_CHECKED = "2026-11-10";

export const GOOGLE_PRICING_SOURCE: PriceSource = {
  url: "https://developers.google.com/maps/billing-and-pricing/pricing",
  checked: PRICING_CHECKED,
  note:
    "Essentials SKUs. Free monthly cap per SKU, then graduated tiers. Volume is counted across all " +
    "projects on the billing account.",
};

export const MAPBOX_PRICING_SOURCE: PriceSource = {
  url: "https://www.mapbox.com/pricing",
  checked: PRICING_CHECKED,
};

export const MAPBOX_PERMANENT_GEOCODING_SOURCE: PriceSource = {
  url: "https://superdupr.com/blog/mapbox-pricing",
  checked: PRICING_CHECKED,
  note:
    "UNVERIFIED: third-party figure. mapbox.com/pricing did not show permanent geocoding. " +
    "Confirm in the Mapbox account before S19.",
};

/** USD per 1,000, graduated (A5). Google tiers start after the free cap. */
export const PRICES = {
  google: {
    dynamicMaps: [free(10_000), tier(100_000, 7.0), tier(500_000, 5.6), tier(1_000_000, 4.2), tier(5_000_000, 2.1), tier(Infinity, 0.53)],
    /** Ends each autocomplete session; requests inside the session are free (Session Usage unlimited). */
    placeDetailsEssentials: [free(10_000), tier(100_000, 5.0), tier(500_000, 4.0), tier(1_000_000, 3.0), tier(5_000_000, 1.5), tier(Infinity, 0.38)],
    geocoding: [free(10_000), tier(100_000, 5.0), tier(500_000, 4.0), tier(1_000_000, 3.0), tier(5_000_000, 1.5), tier(Infinity, 0.38)],
  },
  mapbox: {
    mapLoadsWeb: [free(50_000), tier(100_000, 5.0), tier(200_000, 4.0), tier(1_000_000, 3.0), tier(Infinity, 2.5)],
    temporaryGeocoding: [free(100_000), tier(500_000, 0.75), tier(1_000_000, 0.6), tier(Infinity, 0.45)],
    /** Introductory preview pricing on the pricing page. */
    searchBoxSessionsIntro: [free(500), tier(100_000, 3.0), tier(500_000, 2.75), tier(Infinity, 2.5)],
    searchBoxSessionsStandard: [free(2_500), tier(100_000, 11.5), tier(200_000, 10.0), tier(500_000, 8.4), tier(Infinity, 6.6)],
    /** Needed to store listing coordinates (A5). Unverified third-party figure. */
    permanentGeocoding: [tier(500_000, 5.0), tier(Infinity, 4.0)],
  },
} as const satisfies Record<string, Record<string, readonly PriceTier[]>>;

/** Docs checked before coding (decision 2, A1). */
export const API_DOCS: readonly { api: string; url: string }[] = [
  { api: "Google Places API (New) Autocomplete", url: "https://developers.google.com/maps/documentation/places/web-service/place-autocomplete" },
  { api: "Google Geocoding API", url: "https://developers.google.com/maps/documentation/geocoding/requests-geocoding" },
  { api: "Google Geocoding policies (storage)", url: "https://developers.google.com/maps/documentation/geocoding/policies" },
  { api: "Google Maps Static API", url: "https://developers.google.com/maps/documentation/maps-static/start" },
  { api: "Mapbox Geocoding API v6", url: "https://docs.mapbox.com/api/search/geocoding/" },
  { api: "Mapbox Search Box API", url: "https://docs.mapbox.com/api/search/search-box/" },
  { api: "Mapbox Static Images API", url: "https://docs.mapbox.com/api/maps/static-images/" },
  { api: "Nominatim Search", url: "https://nominatim.org/release-docs/latest/api/Search/" },
];
