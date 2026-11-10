/** Mapbox clients (amendment A1). Server-side only; the token never leaves here. */
import { z } from "zod";
import { TILE_SIZE } from "../config";
import { fetchWithTimeout, ProviderError, readJson } from "../http";
import { mapboxPrecision } from "../scoring";
import type { GeocodeAnswer, Suggestion } from "../types";

const suggestSchema = z.object({
  suggestions: z.array(
    z.object({
      name: z.string(),
      full_address: z.string().optional(),
      place_formatted: z.string().optional(),
    }),
  ),
});

/** Search Box `/suggest`. A session with no `/retrieve` ends after 180 s and bills once. */
export async function mapboxSearchBoxSuggest(q: string, token: string, sessionToken: string): Promise<Suggestion[]> {
  const url = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
  url.searchParams.set("q", q);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("country", "ke");
  url.searchParams.set("limit", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("access_token", token);
  const body = suggestSchema.parse(await readJson(await fetchWithTimeout(url.toString()), "Mapbox Search Box"));
  return body.suggestions.map((s) => ({ text: [s.name, s.full_address ?? s.place_formatted ?? ""].filter(Boolean).join(", ") }));
}

const contextEntry = z.object({ name: z.string().optional() }).optional();

const forwardSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        name: z.string().optional(),
        full_address: z.string().optional(),
        place_formatted: z.string().optional(),
        feature_type: z.string(),
        context: z.record(z.string(), contextEntry).optional(),
      }),
    }),
  ),
});

type ForwardFeature = z.infer<typeof forwardSchema>["features"][number];

async function forward(q: string, token: string, autocomplete: boolean, limit: number): Promise<ForwardFeature[]> {
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", q);
  url.searchParams.set("country", "ke");
  url.searchParams.set("autocomplete", String(autocomplete));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("language", "en");
  url.searchParams.set("access_token", token);
  const body = forwardSchema.parse(await readJson(await fetchWithTimeout(url.toString()), "Mapbox geocoding"));
  return body.features;
}

function featureText(f: ForwardFeature): string {
  const p = f.properties;
  const context = Object.values(p.context ?? {}).flatMap((c) => (c?.name ? [c.name] : []));
  return [p.name, p.full_address ?? p.place_formatted, ...context].filter(Boolean).join(", ");
}

/** Geocoding v6 used as autocomplete (`autocomplete=true`), billed per request. */
export async function mapboxGeocodingSuggest(q: string, token: string): Promise<Suggestion[]> {
  const features = await forward(q, token, true, 5);
  return features.map((f) => ({ text: [f.properties.name, f.properties.full_address ?? f.properties.place_formatted].filter(Boolean).join(", ") }));
}

export async function mapboxGeocode(q: string, token: string): Promise<GeocodeAnswer | null> {
  const [first] = await forward(q, token, false, 1);
  if (!first) return null;
  const [lng, lat] = first.geometry.coordinates;
  return { lat, lng, precision: mapboxPrecision(first.properties.feature_type), text: featureText(first) };
}

export async function mapboxStaticImage(lat: number, lng: number, zoom: number, token: string): Promise<Uint8Array> {
  const path = `${lng},${lat},${zoom}/${TILE_SIZE.width}x${TILE_SIZE.height}`;
  const url = new URL(`https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${path}`);
  url.searchParams.set("access_token", token);
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new ProviderError(`Mapbox static image: HTTP ${response.status}`, response.status === 401 || response.status === 403);
  }
  return new Uint8Array(await response.arrayBuffer());
}
