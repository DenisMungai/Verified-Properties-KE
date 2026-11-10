/**
 * OpenStreetMap Nominatim, the independent reference source (decision 3). Usage policy: at most
 * 1 request per second, an identifying User-Agent, results stored and not re-queried.
 */
import { z } from "zod";
import { USER_AGENT } from "../config";
import { fetchWithTimeout, readJson } from "../http";
import { neighbourhoodIsTown } from "../scoring";
import type { ReferencePoint, TestLocation } from "../types";

const searchSchema = z.array(
  z.object({
    lat: z.string(),
    lon: z.string(),
    osm_type: z.string(),
    osm_id: z.number(),
    addresstype: z.string().optional(),
    type: z.string().optional(),
  }),
);

/** Areas too coarse to stand in for any town or neighbourhood (sub-county centroids drift km). */
const COARSE = new Set(["county", "state", "state_district", "region", "country", "municipality"]);
/** Town-level places: fine only when the neighbourhood is the town itself. */
const TOWN_LEVEL = new Set(["city", "town"]);

function acceptable(type: string, location: TestLocation): boolean {
  if (COARSE.has(type)) return false;
  return !TOWN_LEVEL.has(type) || neighbourhoodIsTown(location);
}

export async function nominatimReference(location: TestLocation): Promise<ReferencePoint> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${location.query}, Kenya`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ke");
  url.searchParams.set("limit", "5");
  const response = await fetchWithTimeout(url.toString(), { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
  const results = searchSchema.parse(await readJson(response, "Nominatim"));
  if (results.length === 0) return { id: location.id, source: "none", lat: null, lng: null, osmId: null, type: null, note: "no OSM result" };

  const typed = results.map((r) => ({ ...r, kind: r.addresstype ?? r.type ?? "unknown" }));
  const pick = typed.find((r) => acceptable(r.kind, location));
  if (!pick) {
    const first = typed[0];
    const note = `top ${typed.length} OSM results are too coarse (${[...new Set(typed.map((r) => r.kind))].join(", ")})`;
    return { id: location.id, source: "none", lat: null, lng: null, osmId: `${first.osm_type}/${first.osm_id}`, type: first.kind, note };
  }
  return { id: location.id, source: "osm", lat: Number(pick.lat), lng: Number(pick.lon), osmId: `${pick.osm_type}/${pick.osm_id}`, type: pick.kind };
}
