/**
 * Local persistence for the provider test.
 *
 * - `.provider-test/outcomes.json` (gitignored): derived outcomes only, never provider
 *   content (amendment A2).
 * - `scripts/lib/maps-test/reference-points.json` (committed, ODbL): OSM reference points
 *   (amendment A3).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { WORK_DIR } from "./config";
import type { AutocompleteOutcome, GeocodeOutcome, ReferencePoint } from "./types";

export const OUTCOMES_FILE = path.join(WORK_DIR, "outcomes.json");
export const TILES_DIR = path.join(WORK_DIR, "tiles");
export const REFERENCE_FILE = path.join("scripts", "lib", "maps-test", "reference-points.json");

export type AutocompleteApi = "google" | "mapbox-searchbox" | "mapbox-geocoding";
export const AUTOCOMPLETE_APIS: readonly AutocompleteApi[] = ["google", "mapbox-searchbox", "mapbox-geocoding"];

export interface OutcomeStore {
  version: 1;
  /** Cumulative billable requests made across runs, per provider. */
  billed: Record<string, number>;
  geocode: Record<string, GeocodeOutcome>;
  autocomplete: Record<string, AutocompleteOutcome>;
  /** km between the two providers' geocoded points, per location id. */
  gaps: Record<string, number>;
  lastRun: string | null;
}

const emptyStore = (): OutcomeStore => ({ version: 1, billed: {}, geocode: {}, autocomplete: {}, gaps: {}, lastRun: null });

export function loadOutcomes(): OutcomeStore {
  if (!existsSync(OUTCOMES_FILE)) return emptyStore();
  const parsed = JSON.parse(readFileSync(OUTCOMES_FILE, "utf8")) as Partial<OutcomeStore>;
  return { ...emptyStore(), ...parsed, version: 1 };
}

export function saveOutcomes(store: OutcomeStore): void {
  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(OUTCOMES_FILE, `${JSON.stringify(store, null, 2)}\n`);
}

/** Outcome keys never contain secrets. A geocode key includes the reference point (A2). */
export function referenceKey(ref: ReferencePoint | undefined): string {
  if (!ref || ref.lat === null || ref.lng === null) return "noref";
  return `${ref.lat.toFixed(6)},${ref.lng.toFixed(6)}`;
}

export function geocodeKey(provider: string, locationId: number, query: string, ref: ReferencePoint | undefined): string {
  return `${provider}|${locationId}|${query}|${referenceKey(ref)}`;
}

export function autocompleteKey(api: AutocompleteApi, locationId: number, query: string): string {
  return `${api}|${locationId}|${query}`;
}

export function gapKey(locationId: number, ref: ReferencePoint | undefined): string {
  return `${locationId}|${referenceKey(ref)}`;
}

export function tileFile(provider: string, placeKey: string, zoom: number): string {
  return path.join(TILES_DIR, `${provider}-${placeKey}-z${zoom}.png`);
}

const referenceSchema = z.array(
  z.object({
    id: z.number().int(),
    source: z.enum(["osm", "manual", "none"]),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    osmId: z.string().nullable(),
    type: z.string().nullable(),
    note: z.string().optional(),
  }),
);

export function loadReferences(): Map<number, ReferencePoint> {
  if (!existsSync(REFERENCE_FILE)) return new Map();
  const rows = referenceSchema.parse(JSON.parse(readFileSync(REFERENCE_FILE, "utf8")));
  return new Map(rows.map((r) => [r.id, r]));
}

export function saveReferences(refs: Map<number, ReferencePoint>): void {
  const rows = [...refs.values()].sort((a, b) => a.id - b.id);
  writeFileSync(REFERENCE_FILE, `${JSON.stringify(rows, null, 2)}\n`);
}
