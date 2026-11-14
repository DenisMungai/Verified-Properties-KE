import "server-only";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { getDb } from "@/db";
import { getPublicListing, type PublicListingResult } from "@/db/queries/listing-detail";
import { homeSections, similarListings, type HomeSections, type PublicListingCard } from "@/db/queries/public-listings";

/**
 * Shared cache for public listing reads (prompt cleanup-dedupe-scale, owner decision 2026-11-14).
 * Only data that is the same for every visitor: never anything read from the session, cookies or
 * headers (save state, contact visibility, map links and "mine" stay per request).
 *
 * `use cache: remote` keeps one copy for every server instance (an in-memory store when run
 * locally). Entries are refreshed in the background after 2 minutes and never served after 5, so
 * a change with no write behind it (a plan or review lapsing, which unbadges a lister) shows within
 * 5 minutes. Writes clear entries at once through the helpers at the bottom, called only from
 * Server Actions and Route Handlers: `revalidateTag` throws outside a Next request (jobs:run, seeds).
 */

const PUBLIC_LIFE = { stale: 60, revalidate: 120, expire: 300 };

const ALL_TAG = "public:listings";
const HOME_TAG = "public:home";
const listingTag = (id: string) => `public:listing:${id}`;

/** Every entry carries the ids of the listings it shows, so changing one clears all its appearances. */
function tagListings(ids: readonly string[]): void {
  if (ids.length > 0) cacheTag(...ids.map(listingTag));
}

/** Both home sections for one Nairobi day (`seed` keys the daily rotation). */
export async function cachedHomeSections(seed: string): Promise<HomeSections> {
  "use cache: remote";
  cacheLife(PUBLIC_LIFE);
  cacheTag(ALL_TAG, HOME_TAG);
  const sections = await homeSections(getDb(), new Date(), seed);
  tagListings([sections.main, sections.county].flatMap((s) => [...s.featured, ...s.newest]).map((card) => card.id));
  return sections;
}

/**
 * One published listing by slug, or null. The result includes `ownerUserId`, which stays on the
 * server (the cache store is server-side); pages must still never pass it to client code.
 */
export async function cachedPublicListing(slug: string): Promise<PublicListingResult | null> {
  "use cache: remote";
  cacheLife(PUBLIC_LIFE);
  cacheTag(ALL_TAG);
  const result = await getPublicListing(getDb(), slug);
  if (result) tagListings([result.listing.id]);
  return result;
}

export type SimilarListingsRef = Parameters<typeof similarListings>[1];

/** The "Similar listings" rail for one listing. */
export async function cachedSimilarListings(ref: SimilarListingsRef): Promise<PublicListingCard[]> {
  "use cache: remote";
  cacheLife(PUBLIC_LIFE);
  cacheTag(ALL_TAG);
  const cards = await similarListings(getDb(), ref);
  tagListings([ref.id, ...cards.map((card) => card.id)]);
  return cards;
}

const NOW = { expire: 0 };

/**
 * One listing changed in a way that can only hide it or change what it shows (edit, photos,
 * pause, delete): clears every entry showing it, and the home page.
 */
export function invalidateListing(listingId: string): void {
  revalidateTag(listingTag(listingId), NOW);
  revalidateTag(HOME_TAG, NOW);
}

/**
 * Anything that can make a listing appear, or change many at once: publishing, unpausing,
 * moderation, verification decisions, payments, lister names and photos, agency changes.
 * (A listing that wasn't visible may sit in the cache as "not found" under its slug alone.)
 */
export function invalidatePublicListings(): void {
  revalidateTag(ALL_TAG, NOW);
}
