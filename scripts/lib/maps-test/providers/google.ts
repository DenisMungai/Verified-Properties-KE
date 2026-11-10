/** Google Maps Platform clients (amendment A1). Server-side only; the key never leaves here. */
import { z } from "zod";
import { TILE_SIZE } from "../config";
import { fetchWithTimeout, ProviderError, readJson } from "../http";
import { googlePrecision } from "../scoring";
import type { GeocodeAnswer, Suggestion } from "../types";

const autocompleteSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z.object({ text: z.object({ text: z.string() }) }).optional(),
      }),
    )
    .optional(),
});

export async function googleAutocomplete(input: string, apiKey: string, sessionToken: string): Promise<Suggestion[]> {
  const response = await fetchWithTimeout("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.text.text",
    },
    body: JSON.stringify({ input, includedRegionCodes: ["ke"], sessionToken, languageCode: "en" }),
  });
  const body = autocompleteSchema.parse(await readJson(response, "Google autocomplete"));
  return (body.suggestions ?? []).flatMap((s) => (s.placePrediction ? [{ text: s.placePrediction.text.text }] : []));
}

const geocodeSchema = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  results: z.array(
    z.object({
      formatted_address: z.string(),
      types: z.array(z.string()),
      address_components: z.array(z.object({ long_name: z.string() })),
      geometry: z.object({ location: z.object({ lat: z.number(), lng: z.number() }) }),
    }),
  ),
});

export async function googleGeocode(address: string, apiKey: string): Promise<GeocodeAnswer | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:KE");
  url.searchParams.set("region", "ke");
  url.searchParams.set("language", "en");
  url.searchParams.set("key", apiKey);
  const body = geocodeSchema.parse(await readJson(await fetchWithTimeout(url.toString()), "Google geocoding"));
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK") {
    const fatal = body.status === "REQUEST_DENIED" || body.status === "OVER_DAILY_LIMIT";
    throw new ProviderError(`Google geocoding: ${body.status}`, fatal);
  }
  const first = body.results[0];
  if (!first) return null;
  return {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
    precision: googlePrecision(first.types),
    text: [first.formatted_address, ...first.address_components.map((c) => c.long_name)].join(", "),
  };
}

export async function googleStaticMap(lat: number, lng: number, zoom: number, apiKey: string): Promise<Uint8Array> {
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${lat},${lng}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", `${TILE_SIZE.width}x${TILE_SIZE.height}`);
  url.searchParams.set("maptype", "roadmap");
  url.searchParams.set("scale", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("key", apiKey);
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new ProviderError(`Google static map: HTTP ${response.status}`, response.status === 401 || response.status === 403);
  }
  return new Uint8Array(await response.arrayBuffer());
}
