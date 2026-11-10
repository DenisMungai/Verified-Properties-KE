/**
 * The provider test passes: references, geocoding, autocomplete and tiles. Every billable call
 * goes through the outcome cache and the per-provider budget (decision 10).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { MAX_BILLABLE_PER_PROVIDER, NOMINATIM_MIN_INTERVAL_MS, PROVIDER_MIN_INTERVAL_MS } from "./config";
import { Budget, BudgetExceededError, Pacer, ProviderError, scrub } from "./http";
import { LOCATIONS, TILE_PLACES, TILE_ZOOMS } from "./locations";
import { googleAutocomplete, googleGeocode, googleStaticMap } from "./providers/google";
import { mapboxGeocode, mapboxGeocodingSuggest, mapboxSearchBoxSuggest, mapboxStaticImage } from "./providers/mapbox";
import { nominatimReference } from "./providers/nominatim";
import { autocompleteOutcome, autocompleteQuery, geocodeOutcome, hasReferencePoint, haversineKm, type AutocompleteKind } from "./scoring";
import {
  AUTOCOMPLETE_APIS,
  autocompleteKey,
  gapKey,
  geocodeKey,
  saveOutcomes,
  saveReferences,
  TILES_DIR,
  tileFile,
  type AutocompleteApi,
  type OutcomeStore,
} from "./store";
import type { GeocodeAnswer, ProviderId, ReferencePoint, Suggestion } from "./types";

export interface Keys {
  google?: string;
  mapbox?: string;
}

export interface RunOptions {
  keys: Keys;
  providers: ProviderId[];
  refreshReference: boolean;
}

const KINDS: readonly AutocompleteKind[] = ["short", "long"];

export function providerOfApi(api: AutocompleteApi): ProviderId {
  return api === "google" ? "google" : "mapbox";
}

export interface PlanLine {
  provider: ProviderId;
  api: string;
  total: number;
  cached: number;
  billable: number;
  note?: string;
}

/** Planned requests per provider and API, and how many the cache already covers. */
export function plan(store: OutcomeStore, refs: Map<number, ReferencePoint>, providers: readonly ProviderId[]): PlanLine[] {
  const lines: PlanLine[] = [];
  for (const provider of providers) {
    const geocodeCached = LOCATIONS.filter((l) => store.geocode[geocodeKey(provider, l.id, l.query, refs.get(l.id))]).length;
    lines.push({ provider, api: "geocoding", total: LOCATIONS.length, cached: geocodeCached, billable: LOCATIONS.length - geocodeCached });

    for (const api of AUTOCOMPLETE_APIS.filter((a) => providerOfApi(a) === provider)) {
      const total = LOCATIONS.length * KINDS.length;
      const cached = LOCATIONS.flatMap((l) => KINDS.map((k) => autocompleteKey(api, l.id, autocompleteQuery(l, k)))).filter(
        (key) => store.autocomplete[key],
      ).length;
      lines.push({ provider, api: `autocomplete (${api})`, total, cached, billable: total - cached });
    }

    const placesWithRef = TILE_PLACES.filter((p) => hasReferencePoint(refs.get(p.locationId)));
    const total = TILE_PLACES.length * TILE_ZOOMS.length;
    const available = placesWithRef.length * TILE_ZOOMS.length;
    const cached = placesWithRef.flatMap((p) => TILE_ZOOMS.map((z) => tileFile(provider, p.key, z))).filter((f) => existsSync(f)).length;
    lines.push({
      provider,
      api: "static images",
      total,
      cached,
      billable: available - cached,
      note: available < total ? `${total - available} waiting for a reference point` : undefined,
    });
  }
  return lines;
}

export function billableFor(lines: readonly PlanLine[], provider: ProviderId): number {
  return lines.filter((l) => l.provider === provider).reduce((sum, l) => sum + l.billable, 0);
}

type Log = (message: string) => void;

class ProviderRun {
  readonly budget: Budget;
  readonly pacer = new Pacer(PROVIDER_MIN_INTERVAL_MS);
  disabled: string | null = null;
  failures = 0;

  constructor(
    readonly id: ProviderId,
    readonly key: string,
    private readonly store: OutcomeStore,
    private readonly log: Log,
  ) {
    this.budget = new Budget(id, MAX_BILLABLE_PER_PROVIDER);
  }

  /** Runs one billable call; returns undefined when it failed or the provider is disabled. */
  async call<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.disabled) return undefined;
    try {
      this.budget.take();
      this.store.billed[this.id] = (this.store.billed[this.id] ?? 0) + 1;
      await this.pacer.wait();
      return await fn();
    } catch (error) {
      const message = scrub(error instanceof Error ? error.message : String(error), [this.key]);
      if (error instanceof BudgetExceededError || (error instanceof ProviderError && error.fatal)) {
        this.disabled = message;
        this.log(`  ✗ ${this.id} stopped: ${message}`);
      } else {
        this.failures += 1;
        this.log(`  ! ${this.id} ${label} failed: ${message}`);
      }
      return undefined;
    }
  }
}

export async function referencePass(refs: Map<number, ReferencePoint>, refresh: boolean, log: Log): Promise<void> {
  const todo = LOCATIONS.filter((l) => refresh || !refs.has(l.id));
  if (todo.length === 0) {
    log("References: all 50 already stored (use --refresh-reference to re-fetch).");
    return;
  }
  log(`References: fetching ${todo.length} from OpenStreetMap Nominatim (1 per second)…`);
  const pacer = new Pacer(NOMINATIM_MIN_INTERVAL_MS);
  for (const location of todo) {
    await pacer.wait();
    try {
      const ref = await nominatimReference(location);
      refs.set(location.id, ref);
      saveReferences(refs);
      log(`  #${location.id} ${location.query}: ${ref.source}${ref.type ? ` (${ref.type})` : ""}${ref.note ? `, ${ref.note}` : ""}`);
    } catch (error) {
      log(`  ! #${location.id} reference failed: ${error instanceof Error ? error.message : String(error)} (re-run to retry)`);
    }
  }
}

async function geocodeWith(run: ProviderRun, query: string): Promise<GeocodeAnswer | null | undefined> {
  return run.call(`geocode "${query}"`, () => (run.id === "google" ? googleGeocode(query, run.key) : mapboxGeocode(query, run.key)));
}

async function suggestWith(run: ProviderRun, api: AutocompleteApi, query: string): Promise<Suggestion[] | undefined> {
  const session = randomUUID(); // one per prefix query, never reused
  return run.call(`autocomplete "${query}"`, () => {
    if (api === "google") return googleAutocomplete(query, run.key, session);
    if (api === "mapbox-searchbox") return mapboxSearchBoxSuggest(query, run.key, session);
    return mapboxGeocodingSuggest(query, run.key);
  });
}

export async function providerPasses(
  options: RunOptions,
  store: OutcomeStore,
  refs: Map<number, ReferencePoint>,
  log: Log,
): Promise<Map<ProviderId, ProviderRun>> {
  const runs = new Map<ProviderId, ProviderRun>();
  for (const id of options.providers) {
    const key = options.keys[id];
    if (key) runs.set(id, new ProviderRun(id, key, store, log));
  }

  log("Geocoding: 50 locations per provider…");
  for (const location of LOCATIONS) {
    const ref = refs.get(location.id);
    const fresh = new Map<ProviderId, GeocodeAnswer>();
    for (const run of runs.values()) {
      const key = geocodeKey(run.id, location.id, location.query, ref);
      if (store.geocode[key]) continue;
      const answer = await geocodeWith(run, location.query);
      if (answer === undefined) continue;
      store.geocode[key] = geocodeOutcome(answer, location, ref);
      if (answer) fresh.set(run.id, answer);
    }
    const [a, b] = [fresh.get("google"), fresh.get("mapbox")];
    if (a && b) store.gaps[gapKey(location.id, ref)] = Math.round(haversineKm(a, b) * 1000) / 1000;
    saveOutcomes(store);
  }

  for (const api of AUTOCOMPLETE_APIS) {
    const run = runs.get(providerOfApi(api));
    if (!run) continue;
    log(`Autocomplete (${api}): 100 prefix queries…`);
    for (const location of LOCATIONS) {
      for (const kind of KINDS) {
        const query = autocompleteQuery(location, kind);
        const key = autocompleteKey(api, location.id, query);
        if (store.autocomplete[key]) continue;
        const suggestions = await suggestWith(run, api, query);
        if (suggestions === undefined) continue;
        store.autocomplete[key] = autocompleteOutcome(suggestions, location, kind);
      }
    }
    saveOutcomes(store);
  }

  mkdirSync(TILES_DIR, { recursive: true });
  for (const run of runs.values()) {
    log(`Static images (${run.id})…`);
    for (const place of TILE_PLACES) {
      const ref = refs.get(place.locationId);
      if (!hasReferencePoint(ref)) {
        log(`  - ${place.label}: no reference point, skipped`);
        continue;
      }
      for (const zoom of TILE_ZOOMS) {
        const file = tileFile(run.id, place.key, zoom);
        if (existsSync(file)) continue;
        const png = await run.call(`static ${place.key} z${zoom}`, () =>
          run.id === "google" ? googleStaticMap(ref.lat, ref.lng, zoom, run.key) : mapboxStaticImage(ref.lat, ref.lng, zoom, run.key),
        );
        if (png) writeFileSync(file, png);
      }
    }
  }

  store.lastRun = new Date().toISOString();
  saveOutcomes(store);
  return runs;
}

export function writeTileIndex(): string {
  const file = `${TILES_DIR}/index.html`;
  mkdirSync(TILES_DIR, { recursive: true });
  const rows = TILE_PLACES.flatMap((p) =>
    TILE_ZOOMS.map(
      (z) => `<tr><th>${p.label}<br><small>zoom ${z}</small></th>
<td><img src="google-${p.key}-z${z}.png" alt="Google ${p.label} z${z}"></td>
<td><img src="mapbox-${p.key}-z${z}.png" alt="Mapbox ${p.label} z${z}"></td></tr>`,
    ),
  ).join("\n");
  writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><title>S18 tile comparison</title>
<style>body{font-family:system-ui,sans-serif;margin:16px}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;vertical-align:top}img{width:600px;max-width:45vw;height:auto;display:block}</style>
<h1>Tile comparison (local only, delete after S19 starts)</h1>
<p>Score each pair 0–2 on labels, roads, buildings and legibility in scripts/lib/maps-test/tile-scores.ts.</p>
<table><thead><tr><th>Place</th><th>Google (roadmap)</th><th>Mapbox (streets-v12)</th></tr></thead><tbody>
${rows}
</tbody></table>
<p>Map data © Google, © Mapbox © OpenStreetMap contributors.</p>
`,
  );
  return file;
}
