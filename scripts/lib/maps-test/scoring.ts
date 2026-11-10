/**
 * Pure scoring for the S18 provider test (decisions 4–9, amendments A4–A5). No I/O.
 */
import {
  AUTOCOMPLETE_TOP_N,
  LONG_PREFIX,
  NEIGHBOURHOOD_KM,
  PROVIDERS_AGREE_KM,
  REFERENCE_DISAGREE_KM,
  SHORT_PREFIX,
  TOWN_KM,
  WEIGHTS,
} from "./config";
import type {
  AutocompleteOutcome,
  GeocodeAnswer,
  GeocodeOutcome,
  HitLevel,
  Precision,
  PriceTier,
  ReferencePoint,
  Suggestion,
  TestLocation,
  TileJudgement,
} from "./types";

// --- Text matching ----------------------------------------------------------------------------

/** Lower case, strip diacritics and apostrophes, collapse everything else to single spaces. */
export function foldText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when `name` appears in `haystack` as whole words, after folding. */
export function containsName(haystack: string, name: string): boolean {
  const needle = foldText(name);
  if (!needle) return false;
  return ` ${foldText(haystack)} `.includes(` ${needle} `);
}

export function neighbourhoodNames(location: TestLocation): string[] {
  return [location.neighbourhood, ...location.aliases];
}

export function namesNeighbourhood(text: string, location: TestLocation): boolean {
  return neighbourhoodNames(location).some((name) => containsName(text, name));
}

export function namesTownOrCounty(text: string, location: TestLocation): boolean {
  return containsName(text, location.town) || containsName(text, location.county);
}

/** The neighbourhood is the town itself (A4): a city-level result is fine enough. */
export function neighbourhoodIsTown(location: TestLocation): boolean {
  return foldText(location.neighbourhood) === foldText(location.town);
}

// --- Geometry ---------------------------------------------------------------------------------

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kenya's bounding box, slightly padded. */
export function isInKenya(lat: number, lng: number): boolean {
  return lat >= -4.9 && lat <= 5.1 && lng >= 33.8 && lng <= 42.0;
}

// --- Precision mapping (requirement 5) --------------------------------------------------------

/** Google `types` → shared precision, checked finest first. */
const GOOGLE_PRECISION: readonly [Precision, readonly string[]][] = [
  ["address", ["street_address", "premise", "subpremise", "plus_code"]],
  ["street", ["route", "intersection"]],
  ["poi", ["establishment", "point_of_interest", "shopping_mall", "tourist_attraction"]],
  ["neighbourhood", ["neighborhood", "sublocality", "sublocality_level_1", "sublocality_level_2", "sublocality_level_3"]],
  ["city", ["locality", "postal_town"]],
  ["county", ["administrative_area_level_1", "administrative_area_level_2", "administrative_area_level_3"]],
  ["country", ["country"]],
];

/** Mapbox `feature_type` (Geocoding v6 and Search Box) → shared precision. */
const MAPBOX_PRECISION: Readonly<Record<string, Precision>> = {
  poi: "poi",
  address: "address",
  secondary_address: "address",
  block: "address",
  street: "street",
  neighborhood: "neighbourhood",
  locality: "locality",
  place: "city",
  postcode: "locality",
  district: "county",
  region: "county",
  country: "country",
};

export function googlePrecision(types: readonly string[]): Precision {
  for (const [precision, names] of GOOGLE_PRECISION) {
    if (types.some((t) => names.includes(t))) return precision;
  }
  return "unknown";
}

export function mapboxPrecision(featureType: string): Precision {
  return MAPBOX_PRECISION[featureType] ?? "unknown";
}

const FINE: ReadonlySet<Precision> = new Set(["poi", "address", "street", "neighbourhood", "locality"]);

export function isFineEnough(precision: Precision | null, location: TestLocation): boolean {
  if (!precision) return false;
  return FINE.has(precision) || (precision === "city" && neighbourhoodIsTown(location));
}

// --- Geocoding (decision 5) -------------------------------------------------------------------

export function hasReferencePoint(ref: ReferencePoint | undefined): ref is ReferencePoint & { lat: number; lng: number } {
  return !!ref && ref.source !== "none" && ref.lat !== null && ref.lng !== null;
}

export function geocodeOutcome(
  answer: GeocodeAnswer | null,
  location: TestLocation,
  ref: ReferencePoint | undefined,
): GeocodeOutcome {
  if (!answer) {
    return { found: false, precision: null, distanceKm: null, inKenya: false, neighbourhoodNamed: false, townNamed: false };
  }
  return {
    found: true,
    precision: answer.precision,
    distanceKm: hasReferencePoint(ref) ? round(haversineKm(answer, ref), 3) : null,
    inKenya: isInKenya(answer.lat, answer.lng),
    neighbourhoodNamed: namesNeighbourhood(answer.text, location),
    townNamed: containsName(answer.text, location.town),
  };
}

export function geocodeHitLevel(outcome: GeocodeOutcome, location: TestLocation): HitLevel {
  if (!outcome.found || !outcome.inKenya) return "miss";
  const fine = isFineEnough(outcome.precision, location);
  const d = outcome.distanceKm;
  const named = outcome.neighbourhoodNamed || outcome.townNamed;
  // Without a reference point, the neighbourhood itself must be named (stricter).
  const neighbourhood = d !== null ? fine && named && d <= NEIGHBOURHOOD_KM : fine && outcome.neighbourhoodNamed;
  if (neighbourhood) return "neighbourhood";
  if ((d !== null && d <= TOWN_KM) || outcome.townNamed) return "town";
  return "miss";
}

export function hitPoints(level: HitLevel): number {
  return level === "neighbourhood" ? 2 : level === "town" ? 1 : 0;
}

/** Points ÷ (2 × locations), 0–1. */
export function geocodingScore(levels: readonly HitLevel[]): number {
  if (levels.length === 0) return 0;
  return levels.reduce((sum, l) => sum + hitPoints(l), 0) / (2 * levels.length);
}

/** Decision 4: both providers agree with each other but not with the reference. */
export function isDisagreementFlag(gapKm: number | null, distancesKm: readonly (number | null)[]): boolean {
  if (gapKm === null || gapKm > PROVIDERS_AGREE_KM) return false;
  return distancesKm.length > 0 && distancesKm.every((d) => d !== null && d > REFERENCE_DISAGREE_KM);
}

// --- Autocomplete (decision 6, A4) ------------------------------------------------------------

export type AutocompleteKind = "short" | "long";

export function autocompleteQuery(location: TestLocation, kind: AutocompleteKind): string {
  const name = location.neighbourhood;
  if (kind === "short") return name.slice(0, SHORT_PREFIX);
  const context = neighbourhoodIsTown(location) ? location.county : location.town;
  return `${name.slice(0, LONG_PREFIX).trimEnd()}, ${context}`;
}

export function autocompleteOutcome(
  suggestions: readonly Suggestion[],
  location: TestLocation,
  kind: AutocompleteKind,
): AutocompleteOutcome {
  const top = suggestions.slice(0, AUTOCOMPLETE_TOP_N);
  const index = top.findIndex(
    (s) => namesNeighbourhood(s.text, location) && (kind === "short" || namesTownOrCounty(s.text, location)),
  );
  return { rank: index === -1 ? null : index + 1, suggestionCount: suggestions.length };
}

export function autocompleteScore(outcomes: readonly AutocompleteOutcome[]): { hitRate: number; mrr: number } {
  if (outcomes.length === 0) return { hitRate: 0, mrr: 0 };
  const hits = outcomes.filter((o) => o.rank !== null).length;
  const mrr = outcomes.reduce((sum, o) => sum + (o.rank ? 1 / o.rank : 0), 0) / outcomes.length;
  return { hitRate: hits / outcomes.length, mrr };
}

// --- Tiles (decision 7) -----------------------------------------------------------------------

export function tileTotal(j: TileJudgement): number {
  return clamp(j.labels) + clamp(j.roads) + clamp(j.buildings) + clamp(j.legibility);
}

/** Mean per-place total (0–8) normalised to 0–1; null when nothing has been judged yet. */
export function tileScore(judgements: readonly TileJudgement[]): number | null {
  if (judgements.length === 0) return null;
  return judgements.reduce((sum, j) => sum + tileTotal(j), 0) / judgements.length / 8;
}

// --- Cost (decision 8, A5) --------------------------------------------------------------------

/** Graduated monthly cost in USD: each tier prices only the volume that falls inside it. */
export function graduatedCost(volume: number, tiers: readonly PriceTier[]): number {
  let cost = 0;
  let lower = 0;
  for (const t of tiers) {
    if (volume <= lower) break;
    const inTier = Math.min(volume, t.upTo) - lower;
    cost += (inTier / 1000) * t.usdPer1000;
    lower = t.upTo;
  }
  return round(cost, 2);
}

/** Cheapest ÷ this, capped at 1; a free option scores 1 (decision 9). */
export function costScore(costUsd: number, cheapestUsd: number): number {
  if (costUsd <= 0) return 1;
  return Math.min(1, cheapestUsd / costUsd);
}

// --- Totals (decision 9) ----------------------------------------------------------------------

export interface MeasureScores {
  autocomplete: number;
  geocoding: number;
  cost: number;
  /** Null until tiles are judged; counts as 0 in the total and the report says so. */
  tiles: number | null;
}

export function weightedTotal(s: MeasureScores): number {
  return round(
    WEIGHTS.autocomplete * s.autocomplete + WEIGHTS.geocoding * s.geocoding + WEIGHTS.cost * s.cost + WEIGHTS.tiles * (s.tiles ?? 0),
    1,
  );
}

export interface CostLines {
  /** Autocomplete sessions. */
  search: number;
  /** Geocoding on listing save. */
  geocoding: number;
  /** Interactive map loads. */
  tiles: number;
}

export interface ProviderMeasures {
  autocomplete: number;
  geocoding: number;
  tiles: number | null;
  cost: CostLines;
}

export interface Candidate {
  label: string;
  search: string;
  tiles: string;
  scores: MeasureScores;
  costUsd: number;
  total: number;
}

export interface Evaluation {
  candidates: Candidate[];
  bestSingle: Candidate;
  bestSplit: Candidate | null;
  recommended: Candidate;
}

/**
 * Scores every single-provider and split candidate. A split takes autocomplete and geocoding
 * from one provider and tiles from the other, and wins only by SPLIT_MARGIN points or more.
 */
export function evaluate(measures: Readonly<Record<string, ProviderMeasures>>, splitMargin: number): Evaluation {
  const ids = Object.keys(measures);
  const raw: Omit<Candidate, "scores" | "total">[] = [];
  for (const a of ids) {
    for (const b of ids) {
      raw.push({
        label: a === b ? a : `${a} search + ${b} tiles`,
        search: a,
        tiles: b,
        costUsd: round(measures[a].cost.search + measures[a].cost.geocoding + measures[b].cost.tiles, 2),
      });
    }
  }
  const cheapest = Math.min(...raw.map((c) => c.costUsd));
  const candidates: Candidate[] = raw.map((c) => {
    const scores: MeasureScores = {
      autocomplete: measures[c.search].autocomplete,
      geocoding: measures[c.search].geocoding,
      tiles: measures[c.tiles].tiles,
      cost: costScore(c.costUsd, cheapest),
    };
    return { ...c, scores, total: weightedTotal(scores) };
  });
  const byTotal = (x: Candidate, y: Candidate) => y.total - x.total || x.costUsd - y.costUsd;
  const singles = candidates.filter((c) => c.search === c.tiles).sort(byTotal);
  const splits = candidates.filter((c) => c.search !== c.tiles).sort(byTotal);
  const bestSingle = singles[0];
  const bestSplit = splits[0] ?? null;
  const recommended = bestSplit && bestSplit.total >= bestSingle.total + splitMargin ? bestSplit : bestSingle;
  return { candidates, bestSingle, bestSplit, recommended };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(2, value));
}

export function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
