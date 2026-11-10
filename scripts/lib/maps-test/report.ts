/**
 * Builds `docs/PHASE3_PROVIDER_TEST.md` from cached outcomes only (requirement 7). It makes no
 * network calls, so `--report-only` can regenerate it after the tile scores are edited.
 */
import { writeFileSync } from "node:fs";
import {
  API_DOCS,
  AUTOCOMPLETE_TOP_N,
  GOOGLE_PRICING_SOURCE,
  GROWTH_MULTIPLIER,
  LONG_PREFIX,
  MAPBOX_PERMANENT_GEOCODING_SOURCE,
  MAPBOX_PRICING_SOURCE,
  MAX_BILLABLE_PER_PROVIDER,
  NEIGHBOURHOOD_KM,
  PRICES,
  PROVIDERS_AGREE_KM,
  REFERENCE_DISAGREE_KM,
  SHORT_PREFIX,
  SPLIT_MARGIN,
  TOWN_KM,
  TRAFFIC,
  WEIGHTS,
} from "./config";
import { LOCATIONS, TILE_PLACES } from "./locations";
import {
  autocompleteQuery,
  autocompleteScore,
  evaluate,
  geocodeHitLevel,
  geocodingScore,
  graduatedCost,
  isDisagreementFlag,
  round,
  tileScore,
  tileTotal,
  type AutocompleteKind,
  type CostLines,
  type Evaluation,
  type ProviderMeasures,
} from "./scoring";
import { autocompleteKey, gapKey, geocodeKey, type AutocompleteApi, type OutcomeStore } from "./store";
import { TILE_JUDGE, TILE_SCORES } from "./tile-scores";
import type { AutocompleteOutcome, GeocodeOutcome, HitLevel, LocationGroup, ProviderId, ReferencePoint, TestLocation } from "./types";

export const REPORT_FILE = "docs/PHASE3_PROVIDER_TEST.md";

const PROVIDERS: readonly ProviderId[] = ["google", "mapbox"];
const KINDS: readonly AutocompleteKind[] = ["short", "long"];
const NAME: Record<string, string> = {
  google: "Google",
  mapbox: "Mapbox",
  "mapbox-searchbox": "Mapbox Search Box",
  "mapbox-geocoding": "Mapbox Geocoding v6",
};

interface LocationRow {
  location: TestLocation;
  ref: ReferencePoint | undefined;
  geocode: Partial<Record<ProviderId, { outcome: GeocodeOutcome; level: HitLevel }>>;
  autocomplete: Partial<Record<AutocompleteApi, (AutocompleteOutcome | undefined)[]>>;
  gapKm: number | null;
  flagged: boolean;
}

interface ProviderResult {
  id: ProviderId;
  tested: boolean;
  geocodeCoverage: number;
  geocoding: number;
  /** The autocomplete API that counts for this provider (decision 2). */
  autocompleteApi: AutocompleteApi;
  autocomplete: { hitRate: number; mrr: number; coverage: number };
  autocompleteByApi: Partial<Record<AutocompleteApi, { hitRate: number; mrr: number; coverage: number }>>;
  tiles: number | null;
  tilesJudged: number;
  cost: CostLines;
  costGrowth: CostLines;
}

export interface Results {
  rows: LocationRow[];
  providers: ProviderResult[];
  evaluation: Evaluation | null;
  store: OutcomeStore;
}

function scoreApi(rows: readonly LocationRow[], api: AutocompleteApi) {
  const outcomes = rows.flatMap((r) => r.autocomplete[api] ?? []);
  const known = outcomes.filter((o): o is AutocompleteOutcome => !!o);
  // Missing outcomes (failed requests) count as misses; coverage says how many ran.
  const padded = outcomes.map((o) => o ?? { rank: null, suggestionCount: 0 });
  return { ...autocompleteScore(padded), coverage: known.length };
}

function costLines(id: ProviderId, autocompleteApi: AutocompleteApi, multiplier: number): CostLines {
  const sessions = TRAFFIC.autocompleteSessions * multiplier;
  const geocodes = TRAFFIC.geocodes * multiplier;
  const views = TRAFFIC.mapViews * multiplier;
  if (id === "google") {
    return {
      search: graduatedCost(sessions, PRICES.google.placeDetailsEssentials),
      geocoding: graduatedCost(geocodes, PRICES.google.geocoding),
      tiles: graduatedCost(views, PRICES.google.dynamicMaps),
    };
  }
  return {
    search:
      autocompleteApi === "mapbox-searchbox"
        ? graduatedCost(sessions, PRICES.mapbox.searchBoxSessionsIntro)
        : graduatedCost(sessions * TRAFFIC.requestsPerSession, PRICES.mapbox.temporaryGeocoding),
    geocoding: graduatedCost(geocodes, PRICES.mapbox.permanentGeocoding),
    tiles: graduatedCost(views, PRICES.mapbox.mapLoadsWeb),
  };
}

export function computeResults(store: OutcomeStore, refs: Map<number, ReferencePoint>): Results {
  const rows: LocationRow[] = LOCATIONS.map((location) => {
    const ref = refs.get(location.id);
    const geocode: LocationRow["geocode"] = {};
    for (const id of PROVIDERS) {
      const outcome = store.geocode[geocodeKey(id, location.id, location.query, ref)];
      if (outcome) geocode[id] = { outcome, level: geocodeHitLevel(outcome, location) };
    }
    const autocomplete: LocationRow["autocomplete"] = {};
    for (const api of ["google", "mapbox-searchbox", "mapbox-geocoding"] as const) {
      autocomplete[api] = KINDS.map((k) => store.autocomplete[autocompleteKey(api, location.id, autocompleteQuery(location, k))]);
    }
    const gap = store.gaps[gapKey(location.id, ref)];
    const gapKm = gap === undefined ? null : gap;
    const distances = PROVIDERS.map((id) => geocode[id]?.outcome.distanceKm ?? null);
    return { location, ref, geocode, autocomplete, gapKm, flagged: isDisagreementFlag(gapKm, distances) };
  });

  const providers: ProviderResult[] = PROVIDERS.map((id) => {
    const levels = rows.map((r) => r.geocode[id]?.level ?? "miss");
    const geocodeCoverage = rows.filter((r) => r.geocode[id]).length;
    const apis: AutocompleteApi[] = id === "google" ? ["google"] : ["mapbox-searchbox", "mapbox-geocoding"];
    const autocompleteByApi: ProviderResult["autocompleteByApi"] = {};
    for (const api of apis) autocompleteByApi[api] = scoreApi(rows, api);
    const autocompleteApi = [...apis].sort((a, b) => {
      const x = autocompleteByApi[a]!;
      const y = autocompleteByApi[b]!;
      return y.hitRate - x.hitRate || y.mrr - x.mrr;
    })[0];
    const judged = TILE_PLACES.flatMap((p) => (TILE_SCORES[id][p.key] ? [TILE_SCORES[id][p.key]] : []));
    return {
      id,
      tested: geocodeCoverage > 0,
      geocodeCoverage,
      geocoding: geocodingScore(levels),
      autocompleteApi,
      autocomplete: autocompleteByApi[autocompleteApi]!,
      autocompleteByApi,
      tiles: tileScore(judged),
      tilesJudged: judged.length,
      cost: costLines(id, autocompleteApi, 1),
      costGrowth: costLines(id, autocompleteApi, GROWTH_MULTIPLIER),
    };
  });

  const tested = providers.filter((p) => p.tested);
  const measures: Record<string, ProviderMeasures> = {};
  for (const p of tested) {
    measures[p.id] = { autocomplete: p.autocomplete.hitRate, geocoding: p.geocoding, tiles: p.tiles, cost: p.cost };
  }
  const evaluation = tested.length > 0 ? evaluate(measures, SPLIT_MARGIN) : null;
  return { rows, providers, evaluation, store };
}

// --- Rendering --------------------------------------------------------------------------------

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => `USD ${x.toFixed(2)}`;
const total = (c: CostLines) => round(c.search + c.geocoding + c.tiles, 2);
const km = (x: number | null) => (x === null ? "–" : x.toFixed(2));
const levelText = (l: HitLevel | undefined) => (l === "neighbourhood" ? "**nbhd**" : l === "town" ? "town" : l === "miss" ? "miss" : "no data");
const rankText = (o: AutocompleteOutcome | undefined) => (o === undefined ? "–" : o.rank === null ? "✗" : String(o.rank));
const ranks = (os: (AutocompleteOutcome | undefined)[] | undefined) => (os ? os.map(rankText).join(" / ") : "– / –");
const cell = (s: string) => s.replace(/\|/g, "\\|");

function summary(results: Results): string[] {
  const { providers, evaluation } = results;
  const lines = [
    "| Provider | Autocomplete (hit rate, MRR) | Geocoding | Tiles | Monthly cost 1× / 3× | Weighted total |",
    "|---|---|---|---|---|---|",
  ];
  for (const p of providers) {
    if (!p.tested) {
      lines.push(`| ${NAME[p.id]} | not tested (no key) | – | – | – | – |`);
      continue;
    }
    const candidate = evaluation?.candidates.find((c) => c.search === p.id && c.tiles === p.id);
    lines.push(
      `| ${NAME[p.id]} | ${pct(p.autocomplete.hitRate)}, ${p.autocomplete.mrr.toFixed(2)} (${NAME[p.autocompleteApi]}) | ` +
        `${pct(p.geocoding)} | ${p.tiles === null ? "not judged" : `${(p.tiles * 8).toFixed(1)} / 8`} | ` +
        `${usd(total(p.cost))} / ${usd(total(p.costGrowth))} | **${candidate?.total ?? "–"}** |`,
    );
  }
  const split = evaluation?.bestSplit;
  if (split) {
    const growth = (id: string, part: keyof CostLines) => providers.find((p) => p.id === id)!.costGrowth[part];
    const splitGrowth = round(growth(split.search, "search") + growth(split.search, "geocoding") + growth(split.tiles, "tiles"), 2);
    lines.push(
      `| Best split: ${cell(split.label)} | (as ${NAME[split.search]}) | (as ${NAME[split.search]}) | (as ${NAME[split.tiles]}) | ` +
        `${usd(split.costUsd)} / ${usd(splitGrowth)} | **${split.total}** |`,
    );
  }
  return lines;
}

function recommendation(results: Results): string[] {
  const { evaluation, providers } = results;
  if (!evaluation) return ["No provider has been tested yet. Add the keys to `.env` and run `npm run maps:test -- --run`."];
  const r = evaluation.recommended;
  const single = evaluation.bestSingle;
  const split = evaluation.bestSplit;
  const untested = providers.filter((p) => !p.tested).map((p) => NAME[p.id]);
  const tilesPending = providers.some((p) => p.tested && p.tiles === null);
  const out = [
    `**Recommended: ${r.search === r.tiles ? NAME[r.search] : `${NAME[r.search]} for search and geocoding, ${NAME[r.tiles]} for tiles`}** ` +
      `(weighted ${r.total} / 100).`,
    "",
    split
      ? `The best single provider is ${NAME[single.search]} at ${single.total}. The best split (${split.label}) scores ${split.total}, ` +
        `${split.total >= single.total + SPLIT_MARGIN ? "which clears" : "which does not clear"} the ${SPLIT_MARGIN}-point margin a second vendor must earn.`
      : `Only ${NAME[single.search]} was tested, so no split was compared.`,
  ];
  if (untested.length) out.push("", `⚠️ Not tested: ${untested.join(", ")}. This is not a comparison until both run.`);
  if (tilesPending) out.push("", "⚠️ Tile scores are not judged yet; tiles count as 0 for every candidate until they are.");
  out.push(
    "",
    "**Storage terms (amendment A6, outside the weighted score):**",
    "",
    "- **Google:** geocoded latitude and longitude may be cached for at most 30 days. Place IDs may be stored indefinitely. A listing's stored point therefore has to come from the lister confirming the pin, or be refreshed.",
    "  - That needs legal confirmation before S19.",
    "- **Mapbox:** permanent geocoding results may be stored indefinitely. It needs a card on file, and is priced per request with no free tier.",
  );
  return out;
}

function groupTable(results: Results): string[] {
  const groups = [...new Set(LOCATIONS.map((l) => l.group))] as LocationGroup[];
  const tested = results.providers.filter((p) => p.tested);
  const lines = [
    `| Group | Locations | ${tested.map((p) => `${NAME[p.id]} nbhd hits`).join(" | ")} |`,
    `|---|---|${tested.map(() => "---").join("|")}|`,
  ];
  for (const g of groups) {
    const rows = results.rows.filter((r) => r.location.group === g);
    const rates = tested.map((p) => {
      const hits = rows.filter((r) => r.geocode[p.id]?.level === "neighbourhood").length;
      return `${hits} / ${rows.length} (${pct(hits / rows.length)})`;
    });
    lines.push(`| ${g} | ${rows.length} | ${rates.join(" | ")} |`);
  }
  return lines;
}

function locationTables(results: Results): string[] {
  const geo = [
    "| # | Query | Reference | Google precision | Google km | Google | Mapbox precision | Mapbox km | Mapbox | Gap km | Flag |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const ac = [
    "| # | Short / long query | Google | Mapbox Search Box | Mapbox Geocoding v6 |",
    "|---|---|---|---|---|",
  ];
  for (const r of results.rows) {
    const g = r.geocode.google;
    const m = r.geocode.mapbox;
    const ref = r.ref ? `${r.ref.source}${r.ref.type ? ` (${r.ref.type})` : ""}` : "not fetched";
    geo.push(
      `| ${r.location.id} | ${cell(r.location.query)} | ${cell(ref)} | ${g?.outcome.precision ?? "–"} | ${km(g?.outcome.distanceKm ?? null)} | ${levelText(g?.level)} | ` +
        `${m?.outcome.precision ?? "–"} | ${km(m?.outcome.distanceKm ?? null)} | ${levelText(m?.level)} | ${km(r.gapKm)} | ${r.flagged ? "⚑ check" : ""} |`,
    );
    ac.push(
      `| ${r.location.id} | \`${cell(autocompleteQuery(r.location, "short"))}\` / \`${cell(autocompleteQuery(r.location, "long"))}\` | ` +
        `${ranks(r.autocomplete.google)} | ${ranks(r.autocomplete["mapbox-searchbox"])} | ${ranks(r.autocomplete["mapbox-geocoding"])} |`,
    );
  }
  return [
    "### Geocoding",
    "",
    `"km" is the distance to the reference point; "nbhd" is a neighbourhood hit. "Gap" is the distance between the two providers' points.`,
    "",
    ...geo,
    "",
    "### Autocomplete",
    "",
    `The rank of the first matching suggestion in the top ${AUTOCOMPLETE_TOP_N}. ✗ means no match; – means no data.`,
    "",
    ...ac,
  ];
}

function exceptions(results: Results): string[] {
  const noRef = results.rows.filter((r) => !r.ref || r.ref.source === "none");
  const flagged = results.rows.filter((r) => r.flagged);
  const out = ["**Rows with no reference point.** These are scored on names only, never by distance.", ""];
  out.push(...(noRef.length ? noRef.map((r) => `- #${r.location.id} ${r.location.query}: ${r.ref?.note ?? "reference not fetched yet"}`) : ["- None."]));
  out.push(
    "",
    `**Disagreement flags.** Both providers are within ${PROVIDERS_AGREE_KM} km of each other and more than ${REFERENCE_DISAGREE_KM} km from OSM, so the reference may be wrong. These rows still count.`,
    "",
  );
  out.push(...(flagged.length ? flagged.map((r) => `- #${r.location.id} ${r.location.query} (OSM ${r.ref?.osmId ?? "?"})`) : ["- None."]));
  return out;
}

function tierText(tiers: readonly { upTo: number; usdPer1000: number }[]): string {
  let lower = 0;
  return tiers
    .map((t) => {
      const range = t.upTo === Infinity ? `${lower.toLocaleString("en")}+` : `${lower.toLocaleString("en")}–${t.upTo.toLocaleString("en")}`;
      lower = t.upTo;
      return `${range}: ${t.usdPer1000 === 0 ? "free" : `$${t.usdPer1000}`}`;
    })
    .join("; ");
}

function costSection(results: Results): string[] {
  const out = [
    "Traffic per month (editable in `scripts/lib/maps-test/config.ts`):",
    "",
    "| Driver | 1× | 3× |",
    "|---|---|---|",
    `| Map views (interactive tile loads) | ${TRAFFIC.mapViews.toLocaleString("en")} | ${(TRAFFIC.mapViews * GROWTH_MULTIPLIER).toLocaleString("en")} |`,
    `| Autocomplete sessions | ${TRAFFIC.autocompleteSessions.toLocaleString("en")} | ${(TRAFFIC.autocompleteSessions * GROWTH_MULTIPLIER).toLocaleString("en")} |`,
    `| Geocoding requests (listing saves and edits) | ${TRAFFIC.geocodes.toLocaleString("en")} | ${(TRAFFIC.geocodes * GROWTH_MULTIPLIER).toLocaleString("en")} |`,
    "",
    `Per-request autocomplete pricing assumes ${TRAFFIC.requestsPerSession} debounced requests per session.`,
    "",
    "| Provider | Search | Geocoding | Tiles | Total 1× | Total 3× |",
    "|---|---|---|---|---|---|",
  ];
  for (const p of results.providers) {
    out.push(
      `| ${NAME[p.id]} (${NAME[p.autocompleteApi]}) | ${usd(p.cost.search)} | ${usd(p.cost.geocoding)} | ${usd(p.cost.tiles)} | ${usd(total(p.cost))} | ${usd(total(p.costGrowth))} |`,
    );
  }
  const standard = graduatedCost(TRAFFIC.autocompleteSessions, PRICES.mapbox.searchBoxSessionsStandard);
  out.push(
    "",
    `For comparison, Mapbox Search Box at *standard* pricing would be ${usd(standard)} a month at 1× for search. Intro pricing may end.`,
    "",
    "Prices in USD per 1,000. Tiers are graduated; each tier prices only the volume inside it:",
    "",
    `- **Google Dynamic Maps:** ${tierText(PRICES.google.dynamicMaps)}`,
    `- **Google Place Details Essentials** (ends each autocomplete session; requests in a session are free): ${tierText(PRICES.google.placeDetailsEssentials)}`,
    `- **Google Geocoding:** ${tierText(PRICES.google.geocoding)}`,
    `- **Mapbox Map Loads for Web:** ${tierText(PRICES.mapbox.mapLoadsWeb)}`,
    `- **Mapbox Search Box sessions (intro):** ${tierText(PRICES.mapbox.searchBoxSessionsIntro)}`,
    `- **Mapbox Temporary Geocoding:** ${tierText(PRICES.mapbox.temporaryGeocoding)}`,
    `- **Mapbox Permanent Geocoding:** ${tierText(PRICES.mapbox.permanentGeocoding)}`,
    "",
    "Sources:",
    "",
    `- Google: ${GOOGLE_PRICING_SOURCE.url}, checked ${GOOGLE_PRICING_SOURCE.checked}. ${GOOGLE_PRICING_SOURCE.note ?? ""}`,
    `- Mapbox: ${MAPBOX_PRICING_SOURCE.url}, checked ${MAPBOX_PRICING_SOURCE.checked}.`,
    `- Mapbox permanent geocoding: ${MAPBOX_PERMANENT_GEOCODING_SOURCE.url}, checked ${MAPBOX_PERMANENT_GEOCODING_SOURCE.checked}. ${MAPBOX_PERMANENT_GEOCODING_SOURCE.note ?? ""}`,
  );
  return out;
}

function methodSection(results: Results): string[] {
  const billed = PROVIDERS.map((p) => `${NAME[p]} ${results.store.billed[p] ?? 0}`).join(", ");
  const tileRows = PROVIDERS.flatMap((p) =>
    TILE_PLACES.map((place) => {
      const j = TILE_SCORES[p][place.key];
      return j
        ? `| ${NAME[p]} | ${place.label} | ${j.labels} | ${j.roads} | ${j.buildings} | ${j.legibility} | ${tileTotal(j)} | ${cell(j.note ?? "")} |`
        : `| ${NAME[p]} | ${place.label} | – | – | – | – | – | not judged |`;
    }),
  );
  return [
    `- **Weights:** autocomplete ${WEIGHTS.autocomplete}, geocoding ${WEIGHTS.geocoding}, cost ${WEIGHTS.cost}, tiles ${WEIGHTS.tiles}. Cost score is the cheapest candidate's cost ÷ this one's, capped at 1. A free candidate scores 1.`,
    `- **Geocoding levels and points:**`,
    `  - **Neighbourhood hit (2 points):** within ${NEIGHBOURHOOD_KM} km of the reference, *and* a result finer than town level, *and* the neighbourhood, an alias or the town named. Without a reference point, the result must be fine and the neighbourhood named.`,
    `  - **Town hit (1 point):** within ${TOWN_KM} km, or the town named.`,
    `  - **Miss (0 points):** anything else, or a result outside Kenya.`,
    `  - When the neighbourhood is the town itself, a city-level result counts as fine.`,
    `- **Autocomplete:** two prefix queries per location: the first ${SHORT_PREFIX} characters of the neighbourhood, and the first ${LONG_PREFIX} plus ", <town>" (county when the neighbourhood is the town).`,
    `  - A hit is the neighbourhood or an alias in the top ${AUTOCOMPLETE_TOP_N}. The long query also needs the town or county, which tells the two Milimanis apart.`,
    `  - Mapbox is scored with whichever of Search Box and Geocoding v6 does better, and that API sets its cost line.`,
    `- **Reference:** OpenStreetMap Nominatim. A result that is only at town level for a neighbourhood query is rejected as "none". No point is ever invented.`,
    `- **Budget:** a cap of ${MAX_BILLABLE_PER_PROVIDER} billable requests per provider per run, with a dry run by default.`,
    `  - Only derived outcomes are cached (amendment A2); provider responses are never stored.`,
    `  - Billable requests made so far: ${billed}.`,
    `- **Last run:** ${results.store.lastRun ?? "never"}.`,
    "",
    "API docs checked on 2026-11-10 before coding:",
    "",
    ...API_DOCS.map((d) => `- ${d.api}: ${d.url}`),
    "",
    `Tile judgements (${TILE_JUDGE}), from 600×400 static images at zooms 13, 15 and 17. Each criterion is 0–2:`,
    "",
    "| Provider | Place | Labels | Roads | Buildings | Legibility | Total / 8 | Note |",
    "|---|---|---|---|---|---|---|---|",
    ...tileRows,
  ];
}

function s19Section(results: Results): string[] {
  const r = results.evaluation?.recommended;
  const lines = ["Whichever provider wins, S19 needs:", ""];
  const google = [
    "- **Google:**",
    "  - **Server key:** `GOOGLE_MAPS_API_KEY`, restricted to Places API (New) and the Geocoding API. Use IP restrictions where the host allows.",
    "  - **Browser key:** `NEXT_PUBLIC_MAP_TOKEN`, restricted to the Maps JavaScript API and HTTP referrers (the live domain and localhost).",
    "  - **Billing:** set a budget alert.",
    "  - **Storage:** store place IDs. Re-check any stored latitude and longitude against the 30-day caching rule.",
  ];
  const mapbox = [
    "- **Mapbox:**",
    "  - **Server token:** `MAPBOX_ACCESS_TOKEN`, a secret `sk.` token with geocoding scopes, for permanent geocoding on save.",
    "  - **Browser token:** `NEXT_PUBLIC_MAP_TOKEN`, a public `pk.` token with URL restrictions (the live domain and localhost).",
    "  - **Billing:** a card on file, needed for permanent geocoding.",
  ];
  if (!r) return [...lines, ...google, ...mapbox];
  const used = new Set([r.search, r.tiles]);
  return [...lines, ...(used.has("google") ? google : []), ...(used.has("mapbox") ? mapbox : [])];
}

export function renderReport(results: Results): string {
  return [
    "# Phase 3 map provider test (S18)",
    "",
    `Prompt: \`prompts/s18-map-provider-test.md\`. Generated by \`npm run maps:test\`; the recommendation is checked by hand.`,
    "",
    "## 1. Summary",
    "",
    ...summary(results),
    "",
    "## 2. Recommendation",
    "",
    ...recommendation(results),
    "",
    "## 3. Neighbourhood hits by group",
    "",
    ...groupTable(results),
    "",
    "## 4. Per location",
    "",
    ...locationTables(results),
    "",
    "## 5. Missing references and flags",
    "",
    ...exceptions(results),
    "",
    "## 6. Cost workings",
    "",
    ...costSection(results),
    "",
    "## 7. Method",
    "",
    ...methodSection(results),
    "",
    "## 8. Limits and caveats",
    "",
    "- **Sample size:** 50 locations is a sample, not a census. A few rows can swing a group's rate.",
    "- **Reference points:** OpenStreetMap is the reference, and its coverage outside Nairobi is uneven. The disagreement flags show where OSM itself may be off.",
    "- **Area size:** large neighbourhoods such as Karen and Embakasi can be more than 2 km across. A correct centroid can still miss the neighbourhood threshold.",
    "- **Tile scores:** these are a judgement from static images, not interactive maps.",
    "- **Prices:** prices change. The Mapbox permanent geocoding figure is unverified, and Search Box intro pricing may end.",
    "",
    "## 9. What S19 needs from the winner",
    "",
    ...s19Section(results),
    "",
    "## 10. Attribution",
    "",
    "Reference points © OpenStreetMap contributors, available under the Open Database Licence (ODbL), via Nominatim. They are stored in `scripts/lib/maps-test/reference-points.json`.",
    "",
    "## 11. Cleanup",
    "",
    "Delete `.provider-test/` (cached outcomes and static images) once S19 starts. It is gitignored and holds no secrets.",
    "",
  ].join("\n");
}

export function writeReport(results: Results): void {
  writeFileSync(REPORT_FILE, renderReport(results));
}
