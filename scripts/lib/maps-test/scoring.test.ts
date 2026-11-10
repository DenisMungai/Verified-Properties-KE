import { describe, expect, it } from "vitest";
import { KENYA_COUNTIES } from "../../../src/lib/kenya";
import { PRICES } from "./config";
import { LOCATIONS, TILE_PLACES } from "./locations";
import {
  autocompleteOutcome,
  autocompleteQuery,
  autocompleteScore,
  containsName,
  costScore,
  evaluate,
  foldText,
  geocodeHitLevel,
  geocodeOutcome,
  geocodingScore,
  googlePrecision,
  graduatedCost,
  haversineKm,
  isDisagreementFlag,
  isFineEnough,
  mapboxPrecision,
  neighbourhoodIsTown,
  tileScore,
  weightedTotal,
  type ProviderMeasures,
} from "./scoring";
import { redactUrl, scrub } from "./http";
import type { GeocodeAnswer, ReferencePoint, TestLocation } from "./types";

const byId = (id: number): TestLocation => {
  const found = LOCATIONS.find((l) => l.id === id);
  if (!found) throw new Error(`no location ${id}`);
  return found;
};
const kilimani = byId(1);
const ruaka = byId(22);
const milimaniKisumu = byId(41);
const langata = byId(16);

const ref = (lat: number, lng: number): ReferencePoint => ({ id: 1, source: "osm", lat, lng, osmId: "relation/1", type: "suburb" });
const noRef: ReferencePoint = { id: 1, source: "none", lat: null, lng: null, osmId: null, type: "city" };

describe("dataset", () => {
  it("has 50 unique locations with valid counties", () => {
    expect(LOCATIONS).toHaveLength(50);
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(50);
    for (const l of LOCATIONS) expect(KENYA_COUNTIES as readonly string[]).toContain(l.county);
  });

  it("marks exactly the rows the prompt lists as neighbourhood = town (A4)", () => {
    const ids = LOCATIONS.filter(neighbourhoodIsTown).map((l) => l.id);
    expect(ids).toEqual([22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 39]);
  });

  it("tile places point at real locations", () => {
    for (const p of TILE_PLACES) expect(LOCATIONS.some((l) => l.id === p.locationId)).toBe(true);
  });
});

describe("text matching", () => {
  it("folds case, apostrophes and diacritics", () => {
    expect(foldText("Lang’ata, NAIROBI")).toBe("langata nairobi");
    expect(foldText("Café  Ruaka")).toBe("cafe ruaka");
  });

  it("matches whole words only", () => {
    expect(containsName("Kilimani, Nairobi, Kenya", "Kilimani")).toBe(true);
    expect(containsName("Kilimanjaro Road", "Kilimani")).toBe(false);
    expect(containsName("South B, Nairobi", "South B")).toBe(true);
    expect(containsName("South Bend", "South B")).toBe(false);
    expect(containsName("Langata Road", "Lang'ata")).toBe(true);
  });
});

describe("geometry", () => {
  it("haversine is about 111 km per degree of latitude", () => {
    expect(haversineKm({ lat: 0, lng: 36 }, { lat: 1, lng: 36 })).toBeCloseTo(111.2, 0);
    expect(haversineKm({ lat: -1.29, lng: 36.79 }, { lat: -1.29, lng: 36.79 })).toBe(0);
  });
});

describe("precision mapping", () => {
  it("maps Google types finest first", () => {
    expect(googlePrecision(["street_address"])).toBe("address");
    expect(googlePrecision(["route"])).toBe("street");
    expect(googlePrecision(["establishment", "point_of_interest", "shopping_mall"])).toBe("poi");
    expect(googlePrecision(["political", "sublocality", "sublocality_level_1"])).toBe("neighbourhood");
    expect(googlePrecision(["neighborhood", "political"])).toBe("neighbourhood");
    expect(googlePrecision(["locality", "political"])).toBe("city");
    expect(googlePrecision(["administrative_area_level_1", "political"])).toBe("county");
    expect(googlePrecision(["country", "political"])).toBe("country");
    expect(googlePrecision(["colloquial_area"])).toBe("unknown");
  });

  it("maps Mapbox feature types", () => {
    expect(mapboxPrecision("neighborhood")).toBe("neighbourhood");
    expect(mapboxPrecision("locality")).toBe("locality");
    expect(mapboxPrecision("place")).toBe("city");
    expect(mapboxPrecision("region")).toBe("county");
    expect(mapboxPrecision("poi")).toBe("poi");
    expect(mapboxPrecision("brand-new-type")).toBe("unknown");
  });

  it("treats city as fine only when the neighbourhood is the town", () => {
    expect(isFineEnough("city", ruaka)).toBe(true);
    expect(isFineEnough("city", kilimani)).toBe(false);
    expect(isFineEnough("neighbourhood", kilimani)).toBe(true);
    expect(isFineEnough(null, kilimani)).toBe(false);
  });
});

describe("geocoding levels (decision 5)", () => {
  const kilimaniRef = ref(-1.2921, 36.7856);
  const answer = (over: Partial<GeocodeAnswer>): GeocodeAnswer => ({
    lat: -1.2921, lng: 36.7856, precision: "neighbourhood", text: "Kilimani, Nairobi, Kenya", ...over,
  });

  it("neighbourhood hit: close, fine and named", () => {
    const o = geocodeOutcome(answer({ lat: -1.30 }), kilimani, kilimaniRef);
    expect(o.distanceKm).toBeLessThan(2);
    expect(geocodeHitLevel(o, kilimani)).toBe("neighbourhood");
  });

  it("a city-level answer is a town hit at most, even when close", () => {
    const o = geocodeOutcome(answer({ precision: "city", text: "Nairobi, Kenya" }), kilimani, kilimaniRef);
    expect(geocodeHitLevel(o, kilimani)).toBe("town");
  });

  it("far but town named is a town hit; far and unnamed is a miss", () => {
    const far = { lat: -1.2, lng: 36.95 };
    expect(geocodeHitLevel(geocodeOutcome(answer({ ...far, text: "Somewhere, Nairobi" }), kilimani, kilimaniRef), kilimani)).toBe("town");
    expect(geocodeHitLevel(geocodeOutcome(answer({ ...far, text: "Somewhere else" }), kilimani, kilimaniRef), kilimani)).toBe("miss");
  });

  it("outside Kenya or no result is a miss", () => {
    expect(geocodeHitLevel(geocodeOutcome(answer({ lat: -3.07, lng: 37.35 + 10 }), kilimani, kilimaniRef), kilimani)).toBe("miss");
    expect(geocodeHitLevel(geocodeOutcome(null, kilimani, kilimaniRef), kilimani)).toBe("miss");
  });

  it("without a reference the neighbourhood itself must be named", () => {
    const named = geocodeOutcome(answer({}), kilimani, noRef);
    expect(named.distanceKm).toBeNull();
    expect(geocodeHitLevel(named, kilimani)).toBe("neighbourhood");
    const townOnly = geocodeOutcome(answer({ text: "Some road, Nairobi" }), kilimani, noRef);
    expect(geocodeHitLevel(townOnly, kilimani)).toBe("town");
  });

  it("the wrong Milimani is not a hit", () => {
    const nakuruMilimani = { lat: -0.2833, lng: 36.0667, precision: "neighbourhood" as const, text: "Milimani, Nakuru, Kenya" };
    const o = geocodeOutcome(nakuruMilimani, milimaniKisumu, ref(-0.0917, 34.7617));
    expect(geocodeHitLevel(o, milimaniKisumu)).toBe("miss");
  });

  it("scores points ÷ 2n", () => {
    expect(geocodingScore(["neighbourhood", "town", "miss", "neighbourhood"])).toBeCloseTo(5 / 8);
    expect(geocodingScore([])).toBe(0);
  });

  it("flags rows where providers agree but the reference does not", () => {
    expect(isDisagreementFlag(0.4, [3.1, 3.4])).toBe(true);
    expect(isDisagreementFlag(0.4, [1.1, 3.4])).toBe(false);
    expect(isDisagreementFlag(1.5, [3.1, 3.4])).toBe(false);
    expect(isDisagreementFlag(null, [3.1, 3.4])).toBe(false);
    expect(isDisagreementFlag(0.4, [null, 3.4])).toBe(false);
  });
});

describe("autocomplete (decision 6, A4)", () => {
  it("builds short and long prefix queries", () => {
    expect(autocompleteQuery(kilimani, "short")).toBe("Kili");
    expect(autocompleteQuery(kilimani, "long")).toBe("Kiliman, Nairobi");
    expect(autocompleteQuery(ruaka, "long")).toBe("Ruaka, Kiambu");
    expect(autocompleteQuery(byId(14), "long")).toBe("Kahawa, Nairobi");
  });

  it("ranks the first matching suggestion within the top 5", () => {
    const s = [{ text: "Kilifi, Kenya" }, { text: "Kilimani, Nairobi, Kenya" }];
    expect(autocompleteOutcome(s, kilimani, "short")).toEqual({ rank: 2, suggestionCount: 2 });
    const many = Array.from({ length: 6 }, (_, i) => ({ text: i === 5 ? "Kilimani" : `Other ${i}` }));
    expect(autocompleteOutcome(many, kilimani, "short").rank).toBeNull();
  });

  it("long queries need the town or county too", () => {
    const s = [{ text: "Milimani, Nakuru, Kenya" }, { text: "Milimani, Kisumu, Kenya" }];
    expect(autocompleteOutcome(s, milimaniKisumu, "short").rank).toBe(1);
    expect(autocompleteOutcome(s, milimaniKisumu, "long").rank).toBe(2);
  });

  it("matches aliases", () => {
    expect(autocompleteOutcome([{ text: "Langata, Nairobi" }], langata, "long").rank).toBe(1);
  });

  it("scores hit rate and MRR", () => {
    const score = autocompleteScore([{ rank: 1, suggestionCount: 5 }, { rank: 2, suggestionCount: 5 }, { rank: null, suggestionCount: 0 }, { rank: 4, suggestionCount: 5 }]);
    expect(score.hitRate).toBe(0.75);
    expect(score.mrr).toBeCloseTo((1 + 0.5 + 0 + 0.25) / 4);
  });
});

describe("cost (decision 8, A5)", () => {
  it("prices graduated tiers after the free cap", () => {
    expect(graduatedCost(30_000, PRICES.google.dynamicMaps)).toBe(140);
    expect(graduatedCost(5_000, PRICES.google.geocoding)).toBe(0);
    expect(graduatedCost(30_000, PRICES.mapbox.mapLoadsWeb)).toBe(0);
    expect(graduatedCost(60_000, PRICES.mapbox.mapLoadsWeb)).toBe(50);
    expect(graduatedCost(20_000, PRICES.mapbox.searchBoxSessionsIntro)).toBe(58.5);
    expect(graduatedCost(2_000, PRICES.mapbox.permanentGeocoding)).toBe(10);
    expect(graduatedCost(0, PRICES.google.dynamicMaps)).toBe(0);
  });

  it("cost score is cheapest ÷ this, and free scores 1", () => {
    expect(costScore(0, 0)).toBe(1);
    expect(costScore(100, 50)).toBe(0.5);
    expect(costScore(50, 50)).toBe(1);
  });
});

describe("tiles and totals (decisions 7, 9)", () => {
  it("averages judged places to 0–1 and clamps criteria", () => {
    expect(tileScore([])).toBeNull();
    expect(tileScore([{ labels: 2, roads: 2, buildings: 2, legibility: 2 }, { labels: 1, roads: 1, buildings: 0, legibility: 2 }])).toBeCloseTo(12 / 16);
    expect(tileScore([{ labels: 5, roads: -1, buildings: 2, legibility: 2 }])).toBeCloseTo(6 / 8);
  });

  it("weights the measures out of 100", () => {
    expect(weightedTotal({ autocomplete: 1, geocoding: 1, cost: 1, tiles: 1 })).toBe(100);
    expect(weightedTotal({ autocomplete: 0.5, geocoding: 0.5, cost: 0, tiles: null })).toBe(35);
  });

  const m = (autocomplete: number, geocoding: number, tiles: number, cost: ProviderMeasures["cost"]): ProviderMeasures => ({
    autocomplete, geocoding, tiles, cost,
  });

  it("recommends the best single provider when a split does not clear the margin", () => {
    const e = evaluate(
      { google: m(0.9, 0.85, 0.9, { search: 50, geocoding: 0, tiles: 140 }), mapbox: m(0.7, 0.7, 0.8, { search: 58.5, geocoding: 10, tiles: 0 }) },
      5,
    );
    expect(e.candidates).toHaveLength(4);
    expect(e.bestSplit?.label).toBe("google search + mapbox tiles");
    expect(e.recommended).toBe(e.bestSplit!.total >= e.bestSingle.total + 5 ? e.bestSplit : e.bestSingle);
  });

  it("recommends a split only when it wins by the margin", () => {
    const e = evaluate(
      { google: m(1, 1, 1, { search: 0, geocoding: 0, tiles: 1000 }), mapbox: m(0.2, 0.2, 1, { search: 0, geocoding: 0, tiles: 0 }) },
      5,
    );
    expect(e.recommended.label).toBe("google search + mapbox tiles");
  });

  it("works with one tested provider", () => {
    const e = evaluate({ google: m(0.8, 0.8, 0.5, { search: 1, geocoding: 1, tiles: 1 }) }, 5);
    expect(e.bestSplit).toBeNull();
    expect(e.recommended.label).toBe("google");
  });
});

describe("secret handling", () => {
  it("redacts key parameters from logged URLs", () => {
    const out = redactUrl("https://maps.googleapis.com/maps/api/geocode/json?address=Kilimani&key=AIzaSECRET123");
    expect(out).not.toContain("AIzaSECRET123");
    expect(out).toContain("key=***");
    expect(redactUrl("https://api.mapbox.com/x?access_token=pk.SECRETTOKEN")).not.toContain("SECRETTOKEN");
  });

  it("scrubs secrets from messages", () => {
    expect(scrub("failed with pk.ABCDEFGHIJ inside", ["pk.ABCDEFGHIJ"])).toBe("failed with *** inside");
    expect(scrub("nothing here", [undefined])).toBe("nothing here");
  });
});
