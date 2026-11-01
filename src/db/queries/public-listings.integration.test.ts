import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { DEFAULT_FILTERS, PAGE_SIZE, type SearchFilters } from "@/lib/search/params";
import { HOME_SLOTS } from "@/lib/search/ranking";
import { homeShowcase, searchListings, type PublicListingCard } from "./public-listings";

/**
 * Public search, ranking and the home showcase against the Neon test branch (TEST_DATABASE_URL).
 * Every test runs in a transaction that is rolled back. Listings already on the branch are
 * archived inside it first, so only the fixtures below are public.
 */
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-10-30T09:00:00Z");
const EXACT_LATITUDE = -1.2920731;

const CARD_KEYS = [
  "areaSqm",
  "bathrooms",
  "bedrooms",
  "category",
  "county",
  "coverAlt",
  "coverKey",
  "id",
  "landSize",
  "landSizeUnit",
  "listerAvatarKey",
  "listerName",
  "listingType",
  "neighbourhood",
  "parkingSpaces",
  "priceKes",
  "rentPeriod",
  "slug",
  "title",
  "town",
  "verified",
];

interface ListingOpts {
  owner: string;
  agencyId?: string | null;
  status?: string;
  listingType?: "sale" | "rent";
  category?: "house" | "apartment" | "land" | "commercial";
  priceKes?: number;
  county?: string;
  town?: string;
  neighbourhood?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  furnished?: boolean;
  parkingSpaces?: number | null;
  /** Days before NOW. */
  ageDays?: number;
  photos?: number;
  title?: string;
}

describe.skipIf(!url)("public listings (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let listingPlanId: string;
  let verificationPlanId: string;
  let slugCounter = 0;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    await client.query(`update properties set status = 'archived' where status = 'published'`);
    listingPlanId = await one(
      `insert into plans (code, kind, name, price_kes, listing_limit) values ('t_s7_list', 'listing', 'L', 1, 100) returning id`,
    );
    verificationPlanId = await one(
      `insert into plans (code, kind, name, price_kes) values ('t_s7_verify', 'verification', 'V', 1) returning id`,
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function one(statement: string, params: unknown[] = []): Promise<string> {
    return (await client.query<{ id: string }>(statement, params)).rows[0].id;
  }

  async function insertAgency(slug: string): Promise<string> {
    return one(`insert into agencies (name, slug) values ($1, $2) returning id`, [`Agency ${slug}`, slug]);
  }

  async function insertLister(id: string, { agencyId = null, verified = false }: { agencyId?: string | null; verified?: boolean } = {}) {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, agency_id) values ($1, $2, $3)`, [
      id,
      `Lister ${id}`,
      agencyId,
    ]);
    if (!verified) return id;
    await client.query(
      `insert into verification_requests (lister_user_id, status, submitted_at, decided_at, review_expires_at)
       values ($1, 'verified', now() - interval '1 day', now(), now() + interval '200 days')`,
      [id],
    );
    for (const [kind, planId] of [
      ["verification", verificationPlanId],
      ["listing", listingPlanId],
    ]) {
      await client.query(
        `insert into subscriptions (owner_user_id, owner_agency_id, kind, plan_id, status,
           current_period_start, current_period_end, grace_ends_at)
         values ($1, $2, $3, $4, 'active', now() - interval '5 days', now() + interval '25 days', now() + interval '28 days')`,
        kind === "listing" && agencyId ? [null, agencyId, kind, planId] : [id, null, kind, planId],
      );
    }
    return id;
  }

  async function insertListing(opts: ListingOpts): Promise<string> {
    const listingType = opts.listingType ?? "sale";
    const category = opts.category ?? "house";
    const home = category === "house" || category === "apartment";
    const status = opts.status ?? "published";
    slugCounter += 1;
    const id = await one(
      `insert into properties (slug, owner_user_id, agency_id, title, description, listing_type, category,
         price_kes, rent_period, bedrooms, bathrooms, land_size, land_size_unit, furnished, parking_spaces,
         county, town, neighbourhood, exact_latitude, exact_longitude, status, published_at)
       values ($1, $2, $3, $4, 'A described listing for search tests.', $5, $6,
         $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, 36.8219, $19, $20)
       returning id`,
      [
        `t-s7-${slugCounter}`,
        opts.owner,
        opts.agencyId ?? null,
        opts.title ?? `Test listing ${slugCounter}`,
        listingType,
        category,
        opts.priceKes ?? 1_000_000,
        listingType === "rent" ? "month" : null,
        home ? (opts.bedrooms === undefined ? 3 : opts.bedrooms) : null,
        home ? (opts.bathrooms === undefined ? 2 : opts.bathrooms) : null,
        category === "land" ? 0.5 : null,
        category === "land" ? "acre" : null,
        opts.furnished ?? false,
        opts.parkingSpaces ?? null,
        opts.county ?? "Nairobi",
        opts.town ?? "Nairobi",
        opts.neighbourhood === undefined ? "Kilimani" : opts.neighbourhood,
        EXACT_LATITUDE,
        status,
        status === "published" || status === "paused" ? new Date(NOW.getTime() - (opts.ageDays ?? 1) * 86_400_000) : null,
      ],
    );
    for (let i = 0; i < (opts.photos ?? 0); i++) {
      await client.query(
        `insert into property_images (property_id, storage_key, alt_text, sort_order, is_cover) values ($1, $2, $3, $4, $5)`,
        [id, `listings/${id}/photo-${i}`, `Photo ${i + 1}`, i, i === 0],
      );
    }
    return id;
  }

  function search(filters: Partial<SearchFilters> = {}, now = NOW) {
    return searchListings(db, { ...DEFAULT_FILTERS, ...filters }, now);
  }

  async function allIds(filters: Partial<SearchFilters> = {}, now = NOW): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await search({ ...filters, page }, now);
      if (result.page !== page) break;
      ids.push(...result.items.map((card) => card.id));
      if (page >= result.pageCount) break;
    }
    return ids;
  }

  /* ---------------------------------------------------------------------- */
  /* Visibility and public fields                                           */
  /* ---------------------------------------------------------------------- */

  it("returns only published listings, on search and the home page", async () => {
    await insertLister("s7_vis");
    const published = await insertListing({ owner: "s7_vis" });
    for (const status of ["draft", "pending_review", "paused", "rejected", "rented", "sold", "withdrawn", "archived"]) {
      await insertListing({ owner: "s7_vis", status });
    }
    for (const sort of ["recommended", "newest", "price_asc", "price_desc"] as const) {
      const result = await search({ sort });
      expect(result.items.map((card) => card.id)).toEqual([published]);
      expect(result.total).toBe(1);
    }
    const home = await homeShowcase(db, NOW);
    expect([...home.featured, ...home.newest].map((card) => card.id)).toEqual([published]);
  });

  it("returns public card fields only", async () => {
    await insertLister("s7_fields");
    await insertListing({ owner: "s7_fields", photos: 2 });
    const { items } = await search();
    expect(Object.keys(items[0]).sort()).toEqual(CARD_KEYS);
    expect(items[0]).toMatchObject({ coverKey: expect.stringContaining("photo-0"), coverAlt: "Photo 1", listerName: "Lister s7_fields" });
    expect(JSON.stringify(items)).not.toContain(String(EXACT_LATITUDE));
    expect(JSON.stringify(items)).not.toContain("s7_fields@");
  });

  it("shows the agency name as the lister for agency listings", async () => {
    const agencyId = await insertAgency("t-s7-name");
    await insertLister("s7_agent", { agencyId });
    await insertListing({ owner: "s7_agent", agencyId });
    expect((await search()).items[0].listerName).toBe("Agency t-s7-name");
  });

  it("pairs the avatar with the lister name: profile photo, or the agency's logo", async () => {
    await insertLister("s7_avatar");
    await client.query(`update lister_profiles set avatar_key = 'avatars/s7_avatar/a' where user_id = 's7_avatar'`);
    const own = await insertListing({ owner: "s7_avatar" });
    const agencyId = await insertAgency("t-s7-logo");
    await client.query(`update agencies set logo_key = 'agencies/t-s7-logo/logo' where id = $1`, [agencyId]);
    await insertLister("s7_agency_member", { agencyId });
    await client.query(`update lister_profiles set avatar_key = 'avatars/s7_agency_member/b' where user_id = 's7_agency_member'`);
    const agencyListing = await insertListing({ owner: "s7_agency_member", agencyId });
    await insertLister("s7_no_avatar");
    const plain = await insertListing({ owner: "s7_no_avatar" });

    const byId = new Map((await search()).items.map((card) => [card.id, card.listerAvatarKey]));
    expect(byId.get(own)).toBe("avatars/s7_avatar/a");
    expect(byId.get(agencyListing)).toBe("agencies/t-s7-logo/logo");
    expect(byId.get(plain)).toBeNull();
  });

  /* ---------------------------------------------------------------------- */
  /* Modes and filters                                                      */
  /* ---------------------------------------------------------------------- */

  it("maps Buy, Rent and Land", async () => {
    await insertLister("s7_modes");
    const saleHouse = await insertListing({ owner: "s7_modes" });
    const saleLand = await insertListing({ owner: "s7_modes", category: "land" });
    const rentFlat = await insertListing({ owner: "s7_modes", listingType: "rent", category: "apartment", priceKes: 50_000 });
    const rentLand = await insertListing({ owner: "s7_modes", listingType: "rent", category: "land", priceKes: 20_000 });
    expect((await allIds({ mode: "buy" })).sort()).toEqual([saleHouse, saleLand].sort());
    expect((await allIds({ mode: "rent" })).sort()).toEqual([rentFlat, rentLand].sort());
    expect((await allIds({ mode: "land" })).sort()).toEqual([saleLand, rentLand].sort());
  });

  it("narrows by every filter", async () => {
    await insertLister("s7_filters");
    await insertLister("s7_verified_f", { verified: true });
    const flat = await insertListing({ owner: "s7_filters", category: "apartment", priceKes: 2_000_000, bedrooms: 1, bathrooms: 1 });
    const bigHouse = await insertListing({
      owner: "s7_filters",
      priceKes: 9_000_000,
      bedrooms: 4,
      bathrooms: 3,
      furnished: true,
      parkingSpaces: 2,
      town: "Ruiru",
      county: "Kiambu",
      neighbourhood: "Membley",
    });
    const verifiedHouse = await insertListing({ owner: "s7_verified_f", priceKes: 5_000_000, neighbourhood: "Karen" });

    expect(await allIds({ types: ["apartment"] })).toEqual([flat]);
    expect((await allIds({ minPrice: 3_000_000 })).sort()).toEqual([bigHouse, verifiedHouse].sort());
    expect((await allIds({ maxPrice: 5_000_000 })).sort()).toEqual([flat, verifiedHouse].sort());
    expect(await allIds({ beds: 4 })).toEqual([bigHouse]);
    expect(await allIds({ baths: 3 })).toEqual([bigHouse]);
    expect(await allIds({ furnished: true })).toEqual([bigHouse]);
    expect(await allIds({ parking: true })).toEqual([bigHouse]);
    expect(await allIds({ verified: true })).toEqual([verifiedHouse]);
    expect(await allIds({ q: "kiambu" })).toEqual([bigHouse]);
    expect(await allIds({ q: "Membl" })).toEqual([bigHouse]);
    expect(await allIds({ q: "karen" })).toEqual([verifiedHouse]);
  });

  it("matches location text literally and ignores titles", async () => {
    await insertLister("s7_like");
    await insertListing({ owner: "s7_like", title: "Near Kilimani but listed in Karen", neighbourhood: "Karen" });
    expect(await allIds({ q: "%" })).toEqual([]);
    expect(await allIds({ q: "_" })).toEqual([]);
    expect(await allIds({ q: "Kilimani" })).toEqual([]);
  });

  it("pages and clamps past the last page", async () => {
    await insertLister("s7_pages");
    await insertLister("s7_pages_v", { verified: true });
    const verifiedOne = await insertListing({ owner: "s7_pages_v", ageDays: 100 });
    for (let i = 0; i < PAGE_SIZE + 3; i++) await insertListing({ owner: `s7_pages`, ageDays: i + 1 });
    const first = await search({ sort: "newest" });
    expect(first.verifiedStrip.map((card) => card.id)).toEqual([verifiedOne]);
    const second = await search({ sort: "newest", page: 2 });
    expect(second).toMatchObject({ total: PAGE_SIZE + 4, page: 2, pageCount: 2 });
    expect(second.items).toHaveLength(4);
    expect(second.verifiedStrip).toEqual([]);
    const clamped = await search({ sort: "newest", page: 40 });
    expect(clamped.page).toBe(2);
    expect(clamped.items.map((card) => card.id)).toEqual(second.items.map((card) => card.id));
    expect(clamped.verifiedStrip).toEqual([]);
    expect(await allIds({ sort: "newest" })).toHaveLength(PAGE_SIZE + 4);
  });

  /* ---------------------------------------------------------------------- */
  /* Recommended                                                            */
  /* ---------------------------------------------------------------------- */

  it("puts verified listers first, then orders by score within a tier", async () => {
    await insertLister("s7_plain");
    await insertLister("s7_plain2");
    await insertLister("s7_ver", { verified: true });
    const strong = await insertListing({ owner: "s7_plain", ageDays: 1, photos: 8 });
    const weak = await insertListing({ owner: "s7_plain2", ageDays: 60, photos: 0, neighbourhood: null });
    const verifiedOld = await insertListing({ owner: "s7_ver", ageDays: 90, photos: 0 });
    const result = await search();
    expect(result.items.map((card) => card.id)).toEqual([verifiedOld, strong, weak]);
    expect(result.items.map((card) => card.verified)).toEqual([true, false, false]);
  });

  it("rotates the verified tier daily and keeps it stable within a day", async () => {
    await insertLister("s7_rot", { verified: true });
    for (let i = 0; i < 6; i++) await insertListing({ owner: `s7_rot`, ageDays: 2, photos: 3 });
    const morning = await allIds({}, new Date("2026-10-30T05:00:00Z"));
    const evening = await allIds({}, new Date("2026-10-30T19:00:00Z"));
    expect(evening).toEqual(morning);
    const orders = new Set<string>();
    for (let day = 1; day <= 6; day++) {
      // Same moment of different days, so scores are identical and only the seed changes.
      orders.add((await allIds({}, new Date(`2026-11-0${day}T05:00:00Z`))).join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("caps any lister, counting an agency as one, at 3 of the first 20", async () => {
    const agencyId = await insertAgency("t-s7-cap");
    await insertLister("s7_big1", { agencyId });
    await insertLister("s7_big2", { agencyId });
    const agencyListings: string[] = [];
    for (let i = 0; i < 6; i++) {
      agencyListings.push(await insertListing({ owner: i % 2 ? "s7_big1" : "s7_big2", agencyId, ageDays: 0.1, photos: 8 }));
    }
    for (let i = 0; i < 20; i++) {
      await insertLister(`s7_small${i}`);
      await insertListing({ owner: `s7_small${i}`, ageDays: 30 + i, photos: 1 });
    }
    const ids = await allIds();
    expect(ids).toHaveLength(26);
    const top = ids.slice(0, 20);
    expect(top.filter((id) => agencyListings.includes(id))).toHaveLength(3);
    // Their best three still lead; the rest are moved after position 20, not dropped.
    expect(ids.slice(0, 3).every((id) => agencyListings.includes(id))).toBe(true);
    expect(ids.slice(20).filter((id) => agencyListings.includes(id))).toHaveLength(3);
  });

  /* ---------------------------------------------------------------------- */
  /* Strict sorts and the verified strip                                    */
  /* ---------------------------------------------------------------------- */

  it("sorts Newest and Price strictly, with a strip of matching verified listings", async () => {
    await insertLister("s7_strict");
    await insertLister("s7_strict_v", { verified: true });
    const newCheap = await insertListing({ owner: "s7_strict", ageDays: 1, priceKes: 100_000 });
    const midMid = await insertListing({ owner: "s7_strict", ageDays: 5, priceKes: 500_000 });
    const verifiedOldDear = await insertListing({ owner: "s7_strict_v", ageDays: 20, priceKes: 900_000 });
    const verifiedRent = await insertListing({ owner: "s7_strict_v", listingType: "rent", priceKes: 10_000 });

    const newest = await search({ sort: "newest" });
    expect(newest.items.map((card) => card.id)).toEqual([newCheap, midMid, verifiedOldDear]);
    expect(newest.verifiedStrip.map((card) => card.id)).toEqual([verifiedOldDear]);

    expect((await search({ sort: "price_asc" })).items.map((card) => card.id)).toEqual([newCheap, midMid, verifiedOldDear]);
    expect((await search({ sort: "price_desc" })).items.map((card) => card.id)).toEqual([verifiedOldDear, midMid, newCheap]);

    // Never adds: the verified rent listing matches neither the Buy results nor their strip,
    // and a filter the verified listing fails empties the strip.
    expect(newest.verifiedStrip.map((card) => card.id)).not.toContain(verifiedRent);
    const capped = await search({ sort: "newest", maxPrice: 600_000 });
    expect(capped.verifiedStrip).toEqual([]);
    expect(capped.items.map((card) => card.id)).not.toContain(verifiedOldDear);

    // Page 2 of a one-page result is clamped to page 1, which shows the strip.
    const clamped = await search({ sort: "newest", page: 2 });
    expect(clamped.page).toBe(1);
    expect(clamped.verifiedStrip.map((card) => card.id)).toEqual([verifiedOldDear]);
    // Recommended already ranks verified listers first, so it has no strip.
    expect((await search()).verifiedStrip).toEqual([]);
  });

  it("shows at most three listings in the strip", async () => {
    await insertLister("s7_strip", { verified: true });
    for (let i = 0; i < 5; i++) await insertListing({ owner: "s7_strip", ageDays: i + 1 });
    const { verifiedStrip } = await search({ sort: "price_asc" });
    expect(verifiedStrip).toHaveLength(3);
    expect(verifiedStrip.every((card) => card.verified)).toBe(true);
  });

  /* ---------------------------------------------------------------------- */
  /* Home showcase                                                          */
  /* ---------------------------------------------------------------------- */

  it("features verified listings with 5+ photos, 2 per lister, and fills with the newest", async () => {
    await insertLister("s7_home_a", { verified: true });
    await insertLister("s7_home_b", { verified: true });
    await insertLister("s7_home_plain");
    const aListings: string[] = [];
    for (let i = 0; i < 4; i++) aListings.push(await insertListing({ owner: "s7_home_a", photos: 5, ageDays: 10 + i }));
    const bFeatured = await insertListing({ owner: "s7_home_b", photos: 6, ageDays: 15 });
    const bFewPhotos = await insertListing({ owner: "s7_home_b", photos: 4, ageDays: 0.5 });
    const plainNew = await insertListing({ owner: "s7_home_plain", photos: 8, ageDays: 0.2 });

    const { featured, newest } = await homeShowcase(db, NOW);
    const featuredIds = featured.map((card) => card.id);
    expect(featuredIds).toHaveLength(3);
    expect(featuredIds.filter((id) => aListings.includes(id))).toHaveLength(2);
    expect(featuredIds).toContain(bFeatured);
    expect(featuredIds).not.toContain(bFewPhotos);
    expect(featuredIds).not.toContain(plainNew);

    // The newest fill the remaining slots: here, every one of the 4 non-featured listings.
    expect(newest).toHaveLength(Math.min(HOME_SLOTS - featuredIds.length, 4));
    expect(newest.map((card) => card.id).slice(0, 2)).toEqual([plainNew, bFewPhotos]);
    expect(newest.some((card) => featuredIds.includes(card.id))).toBe(false);
  });

  it("shows only the newest when nobody qualifies for featured", async () => {
    await insertLister("s7_home_only");
    const ids: string[] = [];
    for (let i = 0; i < HOME_SLOTS + 2; i++) ids.push(await insertListing({ owner: "s7_home_only", photos: 6, ageDays: i + 1 }));
    const { featured, newest } = await homeShowcase(db, NOW);
    expect(featured).toEqual([]);
    expect(newest.map((card: PublicListingCard) => card.id)).toEqual(ids.slice(0, HOME_SLOTS));
  });
});
