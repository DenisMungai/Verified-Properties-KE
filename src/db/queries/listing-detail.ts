import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, listerProfiles, properties, propertyImages } from "@/db/schema";
import { listerAvatarKeySql, publishedOnly } from "./public-listings";

/**
 * The public listing detail page (prompt S8 decision 7). Published rows only. Coordinates, review
 * fields and the pause reason are never selected; the owner id is returned separately for
 * server-side checks (own listing, contact rule) and must not be passed to the browser.
 */

const p = properties;
const pi = propertyImages;

const detailColumns = {
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  listingType: p.listingType,
  category: p.category,
  subtype: p.subtype,
  priceKes: p.priceKes,
  rentPeriod: p.rentPeriod,
  bedrooms: p.bedrooms,
  bathrooms: p.bathrooms,
  areaSqm: p.areaSqm,
  landSize: p.landSize,
  landSizeUnit: p.landSizeUnit,
  furnished: p.furnished,
  parkingSpaces: p.parkingSpaces,
  amenities: p.amenities,
  zoningNotes: p.zoningNotes,
  county: p.county,
  town: p.town,
  neighbourhood: p.neighbourhood,
  publishedAt: p.publishedAt,
  listerName: sql<string | null>`coalesce(${agencies.name}, ${listerProfiles.displayName})`,
  listerAvatarKey: listerAvatarKeySql,
  listerType: listerProfiles.listerType,
  verified: sql<boolean>`lister_verified_now(${p.ownerUserId})`,
};

function selectDetail(db: DbExecutor, slug: string) {
  return db
    .select({ ...detailColumns, ownerUserId: p.ownerUserId })
    .from(p)
    .leftJoin(agencies, eq(agencies.id, p.agencyId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, p.ownerUserId))
    .where(and(eq(p.slug, slug), publishedOnly))
    .limit(1);
}

type DetailRow = Awaited<ReturnType<typeof selectDetail>>[number];

export type PublicListingDetail = Omit<DetailRow, "ownerUserId"> & { photos: { storageKey: string; altText: string }[] };

export interface PublicListingResult {
  listing: PublicListingDetail;
  /** Server-only: for the own-listing check and the contact rule. Never render or serialise it. */
  ownerUserId: string;
}

/** One published listing by slug, or null (unknown, or not published). */
export async function getPublicListing(db: DbExecutor, slug: string): Promise<PublicListingResult | null> {
  if (!/^[a-z0-9-]{1,140}$/.test(slug)) return null;
  const [row] = await selectDetail(db, slug);
  if (!row) return null;
  const photos = await db
    .select({ storageKey: pi.storageKey, altText: pi.altText })
    .from(pi)
    .where(eq(pi.propertyId, row.id))
    .orderBy(desc(pi.isCover), asc(pi.sortOrder), asc(pi.createdAt));
  const { ownerUserId, ...listing } = row;
  return { listing: { ...listing, photos }, ownerUserId };
}
