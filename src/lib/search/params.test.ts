import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  MAX_PAGE,
  PRICE_ORDER_ERROR,
  activeFilters,
  canonicalSearchHref,
  clearFiltersHref,
  escapeLike,
  formDataToParams,
  parsePrice,
  parseSearchParams,
  searchHref,
  type SearchFilters,
} from "./params";

describe("parseSearchParams", () => {
  it("returns the defaults for an empty URL", () => {
    expect(parseSearchParams({})).toEqual({ filters: DEFAULT_FILTERS, errors: {} });
  });

  it("parses every filter", () => {
    const { filters, errors } = parseSearchParams({
      mode: "rent",
      q: "  Kilimani   Nairobi ",
      type: ["apartment", "house"],
      minPrice: "50,000",
      maxPrice: "KSh 120000",
      beds: "2",
      baths: "1",
      furnished: "1",
      parking: "1",
      verified: "1",
      sort: "price_asc",
      page: "3",
    });
    expect(errors).toEqual({});
    expect(filters).toEqual({
      mode: "rent",
      q: "Kilimani Nairobi",
      types: ["house", "apartment"],
      minPrice: 50_000,
      maxPrice: 120_000,
      beds: 2,
      baths: 1,
      furnished: true,
      parking: true,
      verified: true,
      sort: "price_asc",
      page: 3,
    });
  });

  it("drops unknown and malformed values instead of throwing", () => {
    const { filters } = parseSearchParams({
      mode: "lease",
      type: ["villa", "land"],
      minPrice: "-5",
      maxPrice: "1e9",
      beds: "9",
      baths: "0",
      furnished: "yes",
      sort: "cheapest",
      page: "-2",
    });
    expect(filters).toEqual({ ...DEFAULT_FILTERS, types: ["land"] });
  });

  it("ignores property types in land mode", () => {
    expect(parseSearchParams({ mode: "land", type: "house" }).filters.types).toEqual([]);
  });

  it("drops both prices and reports an error when min > max", () => {
    const { filters, errors } = parseSearchParams({ minPrice: "9000000", maxPrice: "100" });
    expect(filters.minPrice).toBeNull();
    expect(filters.maxPrice).toBeNull();
    expect(errors.price).toBe(PRICE_ORDER_ERROR);
  });

  it("caps the page and the query length", () => {
    const { filters } = parseSearchParams({ page: "9999", q: "x".repeat(200) });
    expect(filters.page).toBe(MAX_PAGE);
    expect(filters.q).toHaveLength(80);
  });

  it("treats blank form fields as unset", () => {
    const { filters } = parseSearchParams({ q: " ", minPrice: "", beds: "", sort: "" });
    expect(filters).toEqual(DEFAULT_FILTERS);
  });

  it("uses the first value of a repeated single-value param", () => {
    expect(parseSearchParams({ mode: ["rent", "land"] }).filters.mode).toBe("rent");
  });
});

describe("parsePrice", () => {
  it("accepts commas, spaces and a KSh prefix", () => {
    expect(parsePrice("1,250,000")).toBe(1_250_000);
    expect(parsePrice("KSh 85 000")).toBe(85_000);
    expect(parsePrice("ksh.500")).toBe(500);
  });
  it("rejects anything else", () => {
    expect(parsePrice("1.5")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("999999999999")).toBeNull();
  });
});

describe("searchHref", () => {
  it("omits defaults and drops page 1", () => {
    expect(searchHref({})).toBe("/properties");
    expect(searchHref({ page: 1, sort: "recommended", mode: "buy" })).toBe("/properties");
  });

  it("writes keys in a stable order", () => {
    expect(
      searchHref({
        page: 2,
        sort: "newest",
        verified: true,
        types: ["house", "land"],
        q: "Westlands",
        mode: "rent",
        minPrice: 1000,
        beds: 3,
      }),
    ).toBe("/properties?mode=rent&q=Westlands&type=house&type=land&minPrice=1000&beds=3&verified=1&sort=newest&page=2");
  });

  it("round-trips through the parser", () => {
    const filters: SearchFilters = {
      ...DEFAULT_FILTERS,
      mode: "rent",
      q: "Nyali & Bamburi",
      types: ["apartment"],
      maxPrice: 80_000,
      baths: 2,
      parking: true,
      page: 4,
    };
    const query = Object.fromEntries(
      [...new URL(searchHref(filters), "http://x").searchParams.entries()].reduce((map, [key, value]) => {
        map.set(key, map.has(key) ? [...[map.get(key)!].flat(), value] : value);
        return map;
      }, new Map<string, string | string[]>()),
    );
    expect(parseSearchParams(query).filters).toEqual(filters);
  });
});

describe("activeFilters", () => {
  const filters: SearchFilters = {
    ...DEFAULT_FILTERS,
    mode: "rent",
    q: "Nairobi",
    types: ["house", "apartment"],
    minPrice: 50_000,
    beds: 2,
    furnished: true,
    verified: true,
    sort: "newest",
    page: 3,
  };

  it("makes one chip per filter, never for the mode", () => {
    expect(activeFilters(filters).map((chip) => chip.label)).toEqual([
      "Nairobi",
      "House",
      "Apartment",
      "From KSh 50,000",
      "2+ bedrooms",
      "Furnished",
      "Verified listers only",
    ]);
    expect(activeFilters({ ...DEFAULT_FILTERS, mode: "land" })).toEqual([]);
  });

  it("removes exactly one filter per chip and resets the page", () => {
    const chips = activeFilters(filters);
    expect(chips.find((chip) => chip.id === "type-house")!.href).toBe(
      "/properties?mode=rent&q=Nairobi&type=apartment&minPrice=50000&beds=2&furnished=1&verified=1&sort=newest",
    );
    expect(chips.find((chip) => chip.id === "q")!.href).toBe(
      "/properties?mode=rent&type=house&type=apartment&minPrice=50000&beds=2&furnished=1&verified=1&sort=newest",
    );
  });

  it("labels price ranges", () => {
    const label = (minPrice: number | null, maxPrice: number | null) =>
      activeFilters({ ...DEFAULT_FILTERS, minPrice, maxPrice })[0].label;
    expect(label(1_000_000, 5_000_000)).toBe("KSh 1M – KSh 5M");
    expect(label(null, 80_000)).toBe("Up to KSh 80,000");
  });

  it("clears everything but the mode", () => {
    expect(clearFiltersHref(filters)).toBe("/properties?mode=rent");
  });
});

describe("canonicalSearchHref", () => {
  it("drops blank form fields and the page", () => {
    const raw = formDataToParams([
      ["mode", "rent"],
      ["q", "Nairobi"],
      ["type", ""],
      ["maxPrice", ""],
      ["beds", ""],
      ["page", "3"],
    ]);
    expect(canonicalSearchHref(raw)).toBe("/properties?mode=rent&q=Nairobi");
  });

  it("keeps repeated types", () => {
    const raw = formDataToParams([
      ["type", "house"],
      ["type", "apartment"],
    ]);
    expect(raw).toEqual({ type: ["house", "apartment"] });
    expect(canonicalSearchHref(raw)).toBe("/properties?type=house&type=apartment");
  });

  it("keeps a reversed price range so the page can explain it", () => {
    expect(canonicalSearchHref({ minPrice: "500", maxPrice: "100" })).toBe("/properties?minPrice=500&maxPrice=100");
    expect(canonicalSearchHref({ mode: "land", minPrice: "500", maxPrice: "100" })).toBe(
      "/properties?mode=land&minPrice=500&maxPrice=100",
    );
  });
});

describe("escapeLike", () => {
  it("escapes backslash, percent and underscore", () => {
    expect(escapeLike(String.raw`50%_off\now`)).toBe(String.raw`50\%\_off\\now`);
    expect(escapeLike("Kilimani")).toBe("Kilimani");
  });
});
