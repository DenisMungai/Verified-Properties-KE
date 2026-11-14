import "server-only";
import { and, eq, gte, ilike, inArray, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, favorites, listerProfiles, properties, propertyImages } from "@/db/schema";
import type { LandSizeUnit } from "@/lib/format";
import { PAGE_SIZE, escapeLike, type SearchFilters } from "@/lib/search/params";
import {
  FEATURED_MIN_PHOTOS,
  HOME_COUNTY,
  HOME_COUNTY_SLOTS,
  HOME_PER_LISTER,
  HOME_SLOTS,
  VERIFIED_STRIP_SIZE,
  nairobiDateSeed,
} from "@/lib/search/ranking";
import type { Category, ListingTypeValue, RentPeriod } from "@/lib/validation/listing";
import { cappedRecommendedCtes, rotationKey, scoreSql, strictOrderBy, verifiedTierOrderBy } from "./ranking";

/**
 * Public listing data (plan v2.0 §5–6; prompt S7 decision 11). Every query here:
 *  - reads only `published` rows (`publishedOnly`);
 *  - returns only the public card columns below. Exact coordinates, owner and agency ids,
 *    contact details, review fields and pause reasons are never selected for output; the owner
 *    and agency ids are used inside the SQL (verified flag, per-lister cap) and dropped there.
 * Filter values are always bound parameters.
 */

const p = properties;
const pi = propertyImages;

/** One property card, exactly as it may be sent to a browser. */
export interface PublicListingCard {
  id: string;
  slug: string;
  title: string;
  listingType: ListingTypeValue;
  category: Category;
  priceKes: number;
  rentPeriod: RentPeriod | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  landSize: number | null;
  landSizeUnit: LandSizeUnit | null;
  parkingSpaces: number | null;
  county: string;
  town: string;
  neighbourhood: string | null;
  /** The agency's name, or the lister's public display name. */
  listerName: string | null;
  /** Avatar base key matching `listerName`: the agency's logo or the lister's profile photo. */
  listerAvatarKey: string | null;
  coverKey: string | null;
  coverAlt: string | null;
  /** From `lister_verified_now`, never from the request. */
  verified: boolean;
}

/** Output columns of every public query, in card order. Nothing else leaves the database. */
const CARD_COLUMNS = [
  "id",
  "slug",
  "title",
  "listingType",
  "category",
  "priceKes",
  "rentPeriod",
  "bedrooms",
  "bathrooms",
  "areaSqm",
  "landSize",
  "landSizeUnit",
  "parkingSpaces",
  "county",
  "town",
  "neighbourhood",
  "listerName",
  "listerAvatarKey",
  "coverKey",
  "coverAlt",
  "verified",
] as const satisfies readonly (keyof PublicListingCard)[];

const cardSelect = sql.raw(CARD_COLUMNS.map((column) => `"${column}"`).join(", "));

export const publishedOnly: SQL = eq(p.status, "published");

/**
 * The avatar that goes with the card's lister name (prompt lister-avatars decision 4): an agency
 * listing shows the agency's logo, any other listing the lister's profile photo.
 */
export const listerAvatarKeySql = sql<string | null>`case when ${p.agencyId} is not null then ${agencies.logoKey} else ${listerProfiles.avatarKey} end`;

/** Filter SQL from parsed filters only (decisions 4–5). Always includes `publishedOnly`. */
export function filterConditions(filters: SearchFilters): SQL {
  const conditions: (SQL | undefined)[] = [publishedOnly];
  if (filters.mode === "buy") conditions.push(eq(p.listingType, "sale"));
  if (filters.mode === "rent") conditions.push(eq(p.listingType, "rent"));
  if (filters.mode === "land") conditions.push(eq(p.category, "land"));
  if (filters.mode !== "land" && filters.types.length > 0) conditions.push(inArray(p.category, filters.types));
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    conditions.push(or(ilike(p.county, pattern), ilike(p.town, pattern), ilike(p.neighbourhood, pattern)));
  }
  if (filters.minPrice !== null) conditions.push(gte(p.priceKes, filters.minPrice));
  if (filters.maxPrice !== null) conditions.push(sql`${p.priceKes} <= ${filters.maxPrice}`);
  if (filters.beds !== null) conditions.push(gte(p.bedrooms, filters.beds));
  if (filters.baths !== null) conditions.push(gte(p.bathrooms, filters.baths));
  if (filters.furnished) conditions.push(eq(p.furnished, true));
  if (filters.parking) conditions.push(gte(p.parkingSpaces, 1));
  if (filters.verified) conditions.push(sql`lister_verified_now(${p.ownerUserId})`);
  return and(...conditions)!;
}

/**
 * The `matched` CTE body: matching published rows with their card columns plus the internal
 * ranking columns (`verified`, `score`, `published`, `photo_count`, `lister_key`).
 */
function matchedSql(where: SQL, q: string | null, now: Date): SQL {
  const photoCount = sql`photos.n`;
  return sql`
    select
      ${p.id} as "id",
      ${p.slug} as "slug",
      ${p.title} as "title",
      ${p.listingType} as "listingType",
      ${p.category} as "category",
      ${p.priceKes}::float8 as "priceKes",
      ${p.rentPeriod} as "rentPeriod",
      ${p.bedrooms} as "bedrooms",
      ${p.bathrooms}::float8 as "bathrooms",
      ${p.areaSqm}::float8 as "areaSqm",
      ${p.landSize}::float8 as "landSize",
      ${p.landSizeUnit} as "landSizeUnit",
      ${p.parkingSpaces} as "parkingSpaces",
      ${p.county} as "county",
      ${p.town} as "town",
      ${p.neighbourhood} as "neighbourhood",
      coalesce(${agencies.name}, ${listerProfiles.displayName}) as "listerName",
      ${listerAvatarKeySql} as "listerAvatarKey",
      cover.storage_key as "coverKey",
      cover.alt_text as "coverAlt",
      lister_verified_now(${p.ownerUserId}) as "verified",
      coalesce(${p.agencyId}::text, ${p.ownerUserId}) as lister_key,
      coalesce(${p.publishedAt}, ${p.createdAt}) as published,
      ${photoCount} as photo_count,
      ${scoreSql(q, now, photoCount)} as score
    from ${p}
    left join ${agencies} on ${agencies.id} = ${p.agencyId}
    left join ${listerProfiles} on ${listerProfiles.userId} = ${p.ownerUserId}
    left join lateral (
      select ${pi.storageKey} as storage_key, ${pi.altText} as alt_text
      from ${pi} where ${pi.propertyId} = ${p.id} and ${pi.isCover} limit 1
    ) cover on true
    left join lateral (
      select count(*)::int as n from ${pi} where ${pi.propertyId} = ${p.id}
    ) photos on true
    where ${where}`;
}

async function rowsOf<T>(db: DbExecutor, statement: SQL): Promise<T[]> {
  const result = (await db.execute(statement)) as unknown as { rows: T[] };
  return result.rows;
}

/** Copies only the public card columns, so nothing internal reaches a page by accident. */
function toCard(row: PublicListingCard): PublicListingCard {
  const card = {} as Record<keyof PublicListingCard, unknown>;
  for (const column of CARD_COLUMNS) card[column] = row[column];
  return card as unknown as PublicListingCard;
}

async function cards(db: DbExecutor, statement: SQL): Promise<PublicListingCard[]> {
  return (await rowsOf<PublicListingCard>(db, statement)).map(toCard);
}

export async function countListings(db: DbExecutor, filters: SearchFilters): Promise<number> {
  const [row] = await rowsOf<{ total: number }>(
    db,
    sql`select count(*)::int as total from ${p} where ${filterConditions(filters)}`,
  );
  return row?.total ?? 0;
}

function pageQuery(filters: SearchFilters, now: Date, page: number): SQL {
  const matched = matchedSql(filterConditions(filters), filters.q, now);
  const offset = (page - 1) * PAGE_SIZE;
  if (filters.sort === "recommended") {
    // MATERIALIZED (S22 finding P1): computes lister_verified_now once per matched row. Inlined,
    // Postgres repeated it in every tier sort key, about 21 µs a call.
    return sql`with matched as materialized (${matched}), ${cappedRecommendedCtes(nairobiDateSeed(now))}
      select ${cardSelect} from capped order by final_pos offset ${offset} limit ${PAGE_SIZE}`;
  }
  return sql`with matched as (${matched})
    select ${cardSelect} from matched order by ${strictOrderBy(filters.sort)} offset ${offset} limit ${PAGE_SIZE}`;
}

/** Up to three matching verified listings, in Recommended order (decision 7). */
function verifiedStripQuery(filters: SearchFilters, now: Date): SQL {
  const matched = matchedSql(filterConditions(filters), filters.q, now);
  return sql`with matched as materialized (${matched})
    select ${cardSelect} from matched where verified
    order by ${verifiedTierOrderBy(nairobiDateSeed(now))} limit ${VERIFIED_STRIP_SIZE}`;
}

export interface SearchResult {
  items: PublicListingCard[];
  total: number;
  /** The page shown: the requested page clamped to the last one. */
  page: number;
  pageCount: number;
  /** Newest and Price sorts on page 1 only; empty otherwise. */
  verifiedStrip: PublicListingCard[];
}

/**
 * One results page. The count, the page and the strip run in parallel; a page past the end is
 * fetched again as the last page.
 */
export async function searchListings(db: DbExecutor, filters: SearchFilters, now = new Date()): Promise<SearchResult> {
  const wantsStrip = filters.sort !== "recommended" && filters.page === 1;
  const [total, items, verifiedStrip] = await Promise.all([
    countListings(db, filters),
    cards(db, pageQuery(filters, now, filters.page)),
    wantsStrip ? cards(db, verifiedStripQuery(filters, now)) : Promise.resolve([]),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (filters.page <= pageCount) return { items, total, page: filters.page, pageCount, verifiedStrip };

  const last = { ...filters, page: pageCount };
  const [lastItems, lastStrip] = await Promise.all([
    cards(db, pageQuery(last, now, pageCount)),
    filters.sort !== "recommended" && pageCount === 1 ? cards(db, verifiedStripQuery(last, now)) : Promise.resolve([]),
  ]);
  return { items: lastItems, total, page: pageCount, pageCount, verifiedStrip: lastStrip };
}

export interface HomeShowcase {
  /** Verified listers' listings with enough photos and a cover; at most HOME_PER_LISTER each. */
  featured: PublicListingCard[];
  /** The newest other listings, filling the remaining slots. Never labelled Featured. */
  newest: PublicListingCard[];
}

interface SectionSpec {
  /** Which published listings the section draws from. Must include `publishedOnly`. */
  where: SQL;
  slots: number;
  /** Listings already shown in an earlier section. Server-produced ids, each a bound parameter. */
  excludeIds: readonly string[];
  seed: string;
  now: Date;
}

/**
 * One home section (S7 decision 9; S14 decision 5): verified listings that meet the quality bar,
 * at most HOME_PER_LISTER per lister in this section, rotated daily; the newest fill the rest.
 * The two lists never overlap; together at most `slots`.
 */
async function showcaseSection(db: DbExecutor, { where, slots, excludeIds, seed, now }: SectionSpec): Promise<HomeShowcase> {
  const scoped = excludeIds.length > 0 ? and(where, notInArray(p.id, [...excludeIds]))! : where;
  const matched = matchedSql(scoped, null, now);
  const [featured, newestRows] = await Promise.all([
    cards(
      db,
      sql`with matched as materialized (${matched}),
        candidates as (
          select m.*, row_number() over (partition by lister_key order by ${rotationKey(seed)}) as lr
          from matched m
          where verified and photo_count >= ${FEATURED_MIN_PHOTOS} and "coverKey" is not null
        )
        select ${cardSelect} from candidates where lr <= ${HOME_PER_LISTER}
        order by ${rotationKey(seed)} limit ${slots}`,
    ),
    cards(db, sql`with matched as (${matched}) select ${cardSelect} from matched order by ${strictOrderBy("newest")} limit ${slots}`),
  ]);
  const featuredIds = new Set(featured.map((card) => card.id));
  const newest = newestRows.filter((card) => !featuredIds.has(card.id)).slice(0, slots - featured.length);
  return { featured, newest };
}

export interface HomeSections {
  /** "Verified homes worth a closer look": site-wide, HOME_SLOTS cards. */
  main: HomeShowcase;
  /** "Featured in HOME_COUNTY": that county only, never repeating a card from `main`. */
  county: HomeShowcase;
}

/**
 * Both home sections (S14 decisions 1–2). The county pick needs the main section's ids, so it runs
 * second. `seed` is the daily rotation key; a cached caller passes the one it is keyed by.
 */
export async function homeSections(db: DbExecutor, now = new Date(), seed = nairobiDateSeed(now)): Promise<HomeSections> {
  const main = await showcaseSection(db, { where: publishedOnly, slots: HOME_SLOTS, excludeIds: [], seed, now });
  const shown = [...main.featured, ...main.newest].map((card) => card.id);
  const county = await showcaseSection(db, {
    where: and(publishedOnly, sql`lower(${p.county}) = lower(${HOME_COUNTY})`)!,
    slots: HOME_COUNTY_SLOTS,
    excludeIds: shown,
    seed,
    now,
  });
  return { main, county };
}

export const SIMILAR_LIMIT = 3;

/**
 * Up to three published listings like this one (prompt S8 decision 10): same listing type and
 * category, same town first, then same county, then newest. No verified boost, so nothing here is
 * paid placement.
 */
export async function similarListings(
  db: DbExecutor,
  ref: { id: string; listingType: ListingTypeValue; category: Category; town: string; county: string },
  now = new Date(),
): Promise<PublicListingCard[]> {
  const where = and(publishedOnly, eq(p.listingType, ref.listingType), eq(p.category, ref.category), ne(p.id, ref.id))!;
  return cards(
    db,
    sql`with matched as (${matchedSql(where, null, now)})
      select ${cardSelect} from matched
      order by (lower("town") = lower(${ref.town})) desc, (lower("county") = lower(${ref.county})) desc, published desc, id
      limit ${SIMILAR_LIMIT}`,
  );
}

/** The user's saved listings that are still published, most recently saved first. */
export async function savedListings(db: DbExecutor, userId: string, now = new Date()): Promise<PublicListingCard[]> {
  const where = and(
    publishedOnly,
    sql`${p.id} in (select ${favorites.propertyId} from ${favorites} where ${favorites.userId} = ${userId})`,
  )!;
  return cards(
    db,
    sql`with matched as (${matchedSql(where, null, now)})
      select ${cardSelect} from matched
      order by (select f.created_at from favorites f where f.property_id = matched.id and f.user_id = ${userId}) desc, id`,
  );
}

export const AGENCY_PAGE_SIZE = 24;

/**
 * One page of an agency's published listings for its public page (prompt S23 decision 11):
 * newest first, no ranking tiers (one agency's list, not a search, so nothing paid to disclose).
 */
export async function agencyListings(
  db: DbExecutor,
  agencyId: string,
  page: number,
  now = new Date(),
): Promise<{ items: PublicListingCard[]; total: number; page: number; pageCount: number }> {
  const where = and(publishedOnly, eq(p.agencyId, agencyId))!;
  const [row] = await rowsOf<{ total: number }>(db, sql`select count(*)::int as total from ${p} where ${where}`);
  const total = row?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / AGENCY_PAGE_SIZE));
  const shown = Math.min(Math.max(1, page), pageCount);
  const items = await cards(
    db,
    sql`with matched as (${matchedSql(where, null, now)})
      select ${cardSelect} from matched order by published desc, id
      offset ${(shown - 1) * AGENCY_PAGE_SIZE} limit ${AGENCY_PAGE_SIZE}`,
  );
  return { items, total, page: shown, pageCount };
}
