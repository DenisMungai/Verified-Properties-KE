import { z } from "zod";

/**
 * Google Maps links for listings and agency offices (prompt google-map-links decision 4). Only
 * allow-listed Google Maps hosts over https are accepted, so a trusted page can never carry a
 * phishing or `javascript:` link. The server never fetches or expands the link.
 */

export const MAP_URL_MAX = 500;

export const MAP_URL_ERROR = "Paste a Google Maps link, for example https://maps.app.goo.gl/…";
export const MAP_URL_TOO_LONG = "Use a shorter link. The Share link from the Google Maps app works best.";

/** Hosts where any path is a map. */
const ANY_PATH_HOSTS = new Set(["maps.app.goo.gl", "maps.google.com", "maps.google.co.ke"]);
/** Hosts that also serve non-map pages: only `/maps` and below. */
const MAPS_PATH_HOSTS = new Set(["google.com", "www.google.com", "google.co.ke", "www.google.co.ke"]);

function allowedHostAndPath(host: string, path: string): boolean {
  if (ANY_PATH_HOSTS.has(host)) return true;
  if (host === "goo.gl") return path.startsWith("/maps/");
  if (MAPS_PATH_HOSTS.has(host)) return path === "/maps" || path.startsWith("/maps/");
  return false;
}

export type MapUrlResult = { ok: true; url: string | null } | { ok: false; error: string };

/**
 * Blank → `null`. Adds `https://` when no scheme is given and upgrades `http:`. Returns the
 * normalised URL, or an error message for anything that isn't a Google Maps link.
 */
export function normalizeGoogleMapsUrl(input: string): MapUrlResult {
  const value = input.trim();
  if (value === "") return { ok: true, url: null };
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: MAP_URL_ERROR };
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return { ok: false, error: MAP_URL_ERROR };
  }
  if (!allowedHostAndPath(url.hostname.toLowerCase(), url.pathname)) return { ok: false, error: MAP_URL_ERROR };
  const normalized = url.toString();
  if (normalized.length > MAP_URL_MAX) return { ok: false, error: MAP_URL_TOO_LONG };
  return { ok: true, url: normalized };
}

/** True for a stored link that still passes the allowlist (defence in depth before rendering). */
export function isGoogleMapsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  const result = normalizeGoogleMapsUrl(value);
  return result.ok && result.url === value;
}

/** "maps.app.goo.gl" for display. */
export function mapUrlHost(value: string): string {
  return new URL(value).hostname.replace(/^www\./, "");
}

/** Optional Google Maps link: blank becomes null; anything not on the allowlist is an error. */
export const optionalGoogleMapsUrl = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const result = normalizeGoogleMapsUrl(value ?? "");
    if (result.ok) return result.url;
    ctx.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  });
