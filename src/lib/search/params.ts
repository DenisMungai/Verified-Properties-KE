import { formatKesCompact } from "@/lib/format";
import { CATEGORIES, CATEGORY_LABELS, MAX_PRICE_KES, type Category } from "@/lib/validation/listing";

/**
 * Public search parameters (prompt S7 decision 4). Parsing is defensive: unknown or malformed
 * values are dropped, never thrown, so any URL renders a page. `searchHref` gives the one
 * canonical URL for a set of filters.
 */

export const SEARCH_PATH = "/properties";

export const MODES = ["buy", "rent", "land"] as const;
export type SearchMode = (typeof MODES)[number];

export const SORTS = ["recommended", "newest", "price_asc", "price_desc"] as const;
export type SearchSort = (typeof SORTS)[number];

export const MODE_LABELS: Record<SearchMode, string> = { buy: "Buy", rent: "Rent", land: "Land" };

export const SORT_LABELS: Record<SearchSort, string> = {
  recommended: "Recommended",
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

export const PAGE_SIZE = 12;
/** Keeps OFFSET bounded however the URL is edited. */
export const MAX_PAGE = 500;
export const Q_MAX = 80;
/** Bedrooms and bathrooms mean "N or more". */
export const MIN_ROOMS = 1;
export const MAX_ROOMS = 5;

export const PRICE_ORDER_ERROR = "Minimum price can't be higher than the maximum.";

export interface SearchFilters {
  mode: SearchMode;
  q: string | null;
  /** Always empty in land mode. */
  types: Category[];
  minPrice: number | null;
  maxPrice: number | null;
  beds: number | null;
  baths: number | null;
  furnished: boolean;
  parking: boolean;
  verified: boolean;
  sort: SearchSort;
  page: number;
}

export interface SearchParseResult {
  filters: SearchFilters;
  errors: { price?: string };
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_FILTERS: SearchFilters = {
  mode: "buy",
  q: null,
  types: [],
  minPrice: null,
  maxPrice: null,
  beds: null,
  baths: null,
  furnished: false,
  parking: false,
  verified: false,
  sort: "recommended",
  page: 1,
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function oneOf<T extends string>(options: readonly T[], value: string | undefined): T | undefined {
  return options.find((option) => option === value);
}

/** Whole shillings; commas, spaces and a "KSh" prefix are allowed. */
export function parsePrice(value: string | undefined): number | null {
  if (!value) return null;
  const digits = value.trim().replace(/^ksh\.?/i, "").replace(/[,\s]/g, "");
  if (!/^\d{1,12}$/.test(digits)) return null;
  const amount = Number(digits);
  return amount <= MAX_PRICE_KES ? amount : null;
}

function parseRooms(value: string | undefined): number | null {
  if (!value || !/^\d$/.test(value)) return null;
  const n = Number(value);
  return n >= MIN_ROOMS && n <= MAX_ROOMS ? n : null;
}

function parsePage(value: string | undefined): number {
  if (!value || !/^\d{1,4}$/.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), MAX_PAGE);
}

function parseQuery(value: string | undefined): string | null {
  const q = value?.replace(/\s+/g, " ").trim().slice(0, Q_MAX).trim();
  return q ? q : null;
}

export function parseSearchParams(raw: RawSearchParams): SearchParseResult {
  const mode = oneOf(MODES, first(raw.mode)) ?? "buy";
  const types =
    mode === "land"
      ? []
      : CATEGORIES.filter((category) => all(raw.type).includes(category));
  let minPrice = parsePrice(first(raw.minPrice));
  let maxPrice = parsePrice(first(raw.maxPrice));
  const errors: SearchParseResult["errors"] = {};
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    errors.price = PRICE_ORDER_ERROR;
    minPrice = null;
    maxPrice = null;
  }
  return {
    filters: {
      mode,
      q: parseQuery(first(raw.q)),
      types,
      minPrice,
      maxPrice,
      beds: parseRooms(first(raw.beds)),
      baths: parseRooms(first(raw.baths)),
      furnished: first(raw.furnished) === "1",
      parking: first(raw.parking) === "1",
      verified: first(raw.verified) === "1",
      sort: oneOf(SORTS, first(raw.sort)) ?? "recommended",
      page: parsePage(first(raw.page)),
    },
    errors,
  };
}

/** Canonical URL: defaults omitted, keys in a fixed order, page 1 dropped. */
export function searchHref(filters: Partial<SearchFilters>): string {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const params = new URLSearchParams();
  if (f.mode !== "buy") params.set("mode", f.mode);
  if (f.q) params.set("q", f.q);
  if (f.mode !== "land") for (const type of f.types) params.append("type", type);
  if (f.minPrice !== null) params.set("minPrice", String(f.minPrice));
  if (f.maxPrice !== null) params.set("maxPrice", String(f.maxPrice));
  if (f.beds !== null) params.set("beds", String(f.beds));
  if (f.baths !== null) params.set("baths", String(f.baths));
  if (f.furnished) params.set("furnished", "1");
  if (f.parking) params.set("parking", "1");
  if (f.verified) params.set("verified", "1");
  if (f.sort !== "recommended") params.set("sort", f.sort);
  if (f.page > 1) params.set("page", String(f.page));
  const query = params.toString();
  return query ? `${SEARCH_PATH}?${query}` : SEARCH_PATH;
}

/**
 * Where a submitted search form goes: the canonical URL, without blank fields. When the price
 * range is reversed, both raw prices are kept so the results page can show the error.
 */
export function canonicalSearchHref(raw: RawSearchParams): string {
  const { filters, errors } = parseSearchParams(raw);
  const href = searchHref({ ...filters, page: 1 });
  if (!errors.price) return href;
  const prices = new URLSearchParams({ minPrice: first(raw.minPrice) ?? "", maxPrice: first(raw.maxPrice) ?? "" });
  return `${href}${href.includes("?") ? "&" : "?"}${prices.toString()}`;
}

/** Form entries as raw search params (repeated keys become arrays). */
export function formDataToParams(entries: Iterable<[string, FormDataEntryValue]>): RawSearchParams {
  const raw: Record<string, string | string[]> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string") continue;
    const existing = raw[key];
    raw[key] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  return raw;
}

/** The same search on another page. */
export function pageHref(filters: SearchFilters, page: number): string {
  return searchHref({ ...filters, page });
}

/** Only the mode survives "Clear all". */
export function clearFiltersHref(filters: Pick<SearchFilters, "mode">): string {
  return searchHref({ mode: filters.mode });
}

/** True when anything narrows the results beyond the mode. */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return activeFilters(filters).length > 0;
}

export interface FilterChip {
  id: string;
  label: string;
  /** This search without the chip's filter, back on page 1. */
  href: string;
}

function priceLabel(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatKesCompact(min)} – ${formatKesCompact(max)}`;
  if (min !== null) return `From ${formatKesCompact(min)}`;
  return `Up to ${formatKesCompact(max!)}`;
}

/** Removable chips for every active filter. The mode is the segmented control, not a chip. */
export function activeFilters(filters: SearchFilters): FilterChip[] {
  const base = { ...filters, page: 1 };
  const chips: FilterChip[] = [];
  if (filters.q) chips.push({ id: "q", label: filters.q, href: searchHref({ ...base, q: null }) });
  for (const type of filters.types) {
    chips.push({
      id: `type-${type}`,
      label: CATEGORY_LABELS[type],
      href: searchHref({ ...base, types: filters.types.filter((t) => t !== type) }),
    });
  }
  if (filters.minPrice !== null || filters.maxPrice !== null) {
    chips.push({
      id: "price",
      label: priceLabel(filters.minPrice, filters.maxPrice),
      href: searchHref({ ...base, minPrice: null, maxPrice: null }),
    });
  }
  if (filters.beds !== null) {
    chips.push({ id: "beds", label: `${filters.beds}+ bedrooms`, href: searchHref({ ...base, beds: null }) });
  }
  if (filters.baths !== null) {
    chips.push({ id: "baths", label: `${filters.baths}+ bathrooms`, href: searchHref({ ...base, baths: null }) });
  }
  if (filters.furnished) chips.push({ id: "furnished", label: "Furnished", href: searchHref({ ...base, furnished: false }) });
  if (filters.parking) chips.push({ id: "parking", label: "Parking", href: searchHref({ ...base, parking: false }) });
  if (filters.verified) {
    chips.push({ id: "verified", label: "Verified listers only", href: searchHref({ ...base, verified: false }) });
  }
  return chips;
}

/** Escapes LIKE wildcards so user text matches literally (default escape character `\`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const MODE_TITLES: Record<SearchMode, string> = {
  buy: "Properties for sale in Kenya",
  rent: "Properties for rent in Kenya",
  land: "Land in Kenya",
};

export const MODE_CRUMBS: Record<SearchMode, string> = {
  buy: "Buy property",
  rent: "Rent property",
  land: "Land",
};
