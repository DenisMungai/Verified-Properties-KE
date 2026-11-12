import { randomInt, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { DEFAULT_FILTERS, type SearchFilters } from "@/lib/search/params";
import { setFavorite } from "./favorites";
import { getPublicListing } from "./listing-detail";
import { homeSections, homeShowcase, savedListings, searchListings, similarListings } from "./public-listings";

/**
 * Plan §12: "Public APIs never expose exact coordinates, verification documents, payment details
 * or private columns" (prompt S19 decision 2.1).
 *
 * Every private column around two published listings holds a unique marker: owner and agency
 * contact details, coordinates, the address label, review and pause reasons, a verification
 * document, an invoice, a payment and an inquiry. Then every public read runs, and neither a
 * marker value nor a private-sounding key may appear anywhere in what it returns.
 *
 * Runs against the Neon test branch (TEST_DATABASE_URL) in a rolled-back transaction. Fixture
 * ids are prefixed s19x_.
 */
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-11-10T09:00:00Z");

/** Keys that would mean a private column leaked into a public result. */
const PRIVATE_KEY =
  /email|phone|whatsapp|latitude|longitude|exact|coord|receipt|checkout|invoice|payment|password|reviewed|rejection|pause|addressLabel|owner|agencyId|userId|bio|document|fileName|inquir/i;

/**
 * Allowed exceptions, outside the public objects themselves. `getPublicListing` returns
 * `{ listing, ownerUserId }`; the owner id is for the server-side owner check and contact rule
 * only, and `src/app/route-guards.test.ts` proves the page never puts it in JSX.
 */
const SERVER_ONLY_WRAPPER_KEYS = ["listing", "ownerUserId"];

/** Coordinates as markers: digit runs no other fixture value contains. */
const EXACT = { lat: -1.2345678, lng: 36.8765432 };
const PUBLIC_POINT = { lat: -1.2399123, lng: 36.8799321 };

describe.skipIf(!url)("public exposure guard (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  const markers: string[] = [];
  const mark = (what: string) => {
    const value = `S19MARK-${what}-${randomUUID().slice(0, 8)}`;
    markers.push(value);
    return value;
  };
  /** A unique, valid Kenyan mobile marker (contact columns are format-checked). */
  const markPhone = () => {
    const value = `+2547${String(randomInt(10_000_000, 99_999_999))}`;
    markers.push(value);
    return value;
  };

  let listing: { id: string; slug: string };
  let agencyListing: { id: string; slug: string };

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function one(statement: string, params: unknown[] = []): Promise<string> {
    return (await client.query<{ id: string }>(statement, params)).rows[0].id;
  }

  async function insertUser(id: string, opts: { agencyId?: string; agencyRole?: "admin" | "member" } = {}) {
    const emailMarker = mark(`${id}-email`).toLowerCase();
    await client.query(`insert into users (id, name, email) values ($1, $2, $3)`, [id, mark(`${id}-name`), `${emailMarker}@example.test`]);
    await client.query(
      `insert into lister_profiles (user_id, display_name, agency_id, phone, whatsapp, public_email, bio) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, `Lister ${id}`, opts.agencyId ?? null, mark(`${id}-phone`), markPhone(), mark(`${id}-public-email`), mark(`${id}-bio`)],
    );
    if (opts.agencyRole) {
      await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [opts.agencyId, id, opts.agencyRole]);
    }
  }

  async function insertListing(owner: string, slug: string, agencyId: string | null): Promise<{ id: string; slug: string }> {
    const id = await one(
      `insert into properties (slug, owner_user_id, agency_id, title, description, listing_type, category, price_kes,
         county, town, neighbourhood, address_label, exact_latitude, exact_longitude, public_latitude, public_longitude,
         status, published_at, rejection_reason, pause_reason)
       values ($1, $2, $3, $4, 'A described listing used by the S19 exposure guard.', 'sale', 'apartment', 5000000,
         'Nairobi', 'Nairobi', 'Kilimani', $5, $6, $7, $8, $9, 'published', $10, $11, $12)
       returning id`,
      [
        slug,
        owner,
        agencyId,
        `S19 exposure listing ${slug}`,
        mark("address-label"),
        EXACT.lat,
        EXACT.lng,
        PUBLIC_POINT.lat,
        PUBLIC_POINT.lng,
        new Date(NOW.getTime() - 86_400_000),
        mark("rejection-reason"),
        mark("pause-reason"),
      ],
    );
    for (let n = 0; n < 5; n++) {
      await client.query(
        `insert into property_images (property_id, storage_key, alt_text, sort_order, is_cover) values ($1, $2, $3, $4, $5)`,
        [id, `listings/${id}/p${n}`, `Photo ${n + 1}`, n, n === 0],
      );
    }
    return { id, slug };
  }

  beforeEach(async () => {
    markers.length = 0;
    await client.query("BEGIN");
    // Only this suite's fixtures are public inside the transaction.
    await client.query(`update properties set status = 'archived' where status = 'published'`);

    const agencyId = await one(
      `insert into agencies (name, slug, public_email, public_phone, whatsapp, website_url) values ('S19X Agency', 's19x-agency', $1, $2, $3, 'https://example.test') returning id`,
      [mark("agency-public-email"), markPhone(), markPhone()],
    );
    await insertUser("s19x_owner");
    await insertUser("s19x_agent", { agencyId, agencyRole: "member" });
    await insertUser("s19x_agency_admin", { agencyId, agencyRole: "admin" });
    await insertUser("s19x_buyer");

    listing = await insertListing("s19x_owner", "s19x-listing", null);
    agencyListing = await insertListing("s19x_agent", "s19x-agency-listing", agencyId);

    // Billing: an active plan with an invoice and an STK payment carrying markers.
    const planId = await one(`insert into plans (code, kind, name, price_kes, listing_limit) values ('t_s19x_list', 'listing', 'L', 1, 10) returning id`);
    const subscriptionId = await one(
      `insert into subscriptions (owner_user_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at)
       values ('s19x_owner', 'listing', $1, 'active', now() - interval '5 days', now() + interval '25 days', now() + interval '28 days')
       returning id`,
      [planId],
    );
    const invoiceId = await one(`insert into invoices (subscription_id, plan_id, amount_kes) values ($1, $2, 1) returning id`, [subscriptionId, planId]);
    await client.query(
      `insert into payments (invoice_id, method, phone_e164, checkout_request_id, merchant_request_id, mpesa_receipt, amount_kes)
       values ($1, 'stk_push', $2, $3, $4, $5, 1)`,
      [invoiceId, mark("payment-phone"), mark("checkout-id"), mark("merchant-id"), mark("receipt")],
    );

    // Verification: a request under review with one private document.
    const requestId = await one(
      `insert into verification_requests (lister_user_id, status, submitted_at) values ('s19x_owner', 'under_review', now()) returning id`,
    );
    await client.query(
      `insert into verification_documents (request_id, storage_key, document_type, file_name, content_type, size_bytes)
       values ($1, $2, 'national_id', $3, 'application/pdf', 1000)`,
      [requestId, mark("document-key"), mark("document-name")],
    );

    // A buyer's inquiry and saved listings.
    await client.query(
      `insert into inquiries (property_id, sender_user_id, recipient_user_id, full_name, phone, email, message)
       values ($1, 's19x_buyer', 's19x_owner', $2, $3, $4, $5)`,
      [listing.id, mark("inquiry-name"), mark("inquiry-phone"), mark("inquiry-email"), mark("inquiry-message")],
    );
    await setFavorite(db, "s19x_buyer", listing.id, true);
    await setFavorite(db, "s19x_buyer", agencyListing.id, true);
  });

  /** Every key at any depth of a JSON-safe value. */
  function keysOf(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
    else if (value && typeof value === "object" && !(value instanceof Date)) {
      for (const [k, v] of Object.entries(value)) {
        out.push(k);
        keysOf(v, out);
      }
    }
    return out;
  }

  function expectNothingPrivate(label: string, value: unknown) {
    const json = JSON.stringify(value);
    for (const marker of markers) expect(json, `${label} leaks ${marker.split("-").slice(1, -1).join("-")}`).not.toContain(marker);
    for (const n of [EXACT.lat, EXACT.lng, PUBLIC_POINT.lat, PUBLIC_POINT.lng]) {
      expect(json, `${label} leaks a coordinate`).not.toContain(String(Math.abs(n)).slice(0, 8));
    }
    const leakedKeys = [...new Set(keysOf(value))].filter((k) => PRIVATE_KEY.test(k));
    expect(leakedKeys, `${label} has private-sounding keys`).toEqual([]);
  }

  const search = (filters: Partial<SearchFilters> = {}) => searchListings(db, { ...DEFAULT_FILTERS, ...filters }, NOW);

  it("plants every marker it checks for", async () => {
    // Guards the guard: the fixture really holds the values that must never come back.
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from properties where id = any($1) and exact_latitude = $2 and address_label like 'S19MARK-%'`,
      [[listing.id, agencyListing.id], EXACT.lat],
    );
    expect(rows[0].n).toBe(2);
    expect(markers.length).toBeGreaterThan(20);
  });

  it("search results, in every sort and filter, return public card fields only", async () => {
    for (const sort of ["recommended", "newest", "price_asc", "price_desc"] as const) {
      const result = await search({ sort });
      expect(result.items.map((c) => c.id).sort()).toEqual([listing.id, agencyListing.id].sort());
      expectNothingPrivate(`search (${sort})`, result);
    }
    expectNothingPrivate("search (q)", await search({ q: "Kilimani" }));
    expectNothingPrivate("search (filters)", await search({ types: ["apartment"], minPrice: 1, beds: 0 }));
  });

  it("home sections return public card fields only", async () => {
    const sections = await homeSections(db, NOW);
    const shown = [...sections.main.featured, ...sections.main.newest, ...sections.county.featured, ...sections.county.newest];
    expect(shown.length).toBeGreaterThan(0);
    expectNothingPrivate("home sections", sections);
    expectNothingPrivate("home showcase", await homeShowcase(db, NOW));
  });

  it("the listing detail returns public fields only, with the owner id kept outside the public object", async () => {
    for (const { slug } of [listing, agencyListing]) {
      const result = await getPublicListing(db, slug);
      expect(result).not.toBeNull();
      expect(Object.keys(result!).sort()).toEqual(SERVER_ONLY_WRAPPER_KEYS.sort());
      expectNothingPrivate(`detail ${slug}`, result!.listing);
      expect(result!.listing.photos).toHaveLength(5);
    }
  });

  it("similar listings and saved listings return public card fields only", async () => {
    const similar = await similarListings(db, { id: listing.id, listingType: "sale", category: "apartment", town: "Nairobi", county: "Nairobi" }, NOW);
    expect(similar.map((c) => c.id)).toEqual([agencyListing.id]);
    expectNothingPrivate("similar", similar);

    const saved = await savedListings(db, "s19x_buyer", NOW);
    expect(saved).toHaveLength(2);
    expectNothingPrivate("saved", saved);
  });

  it("returns nothing at all for listings that are not published", async () => {
    for (const status of ["draft", "pending_review", "paused", "rejected", "withdrawn"]) {
      await client.query(`update properties set status = $1 where id = $2`, [status, listing.id]);
      expect(await getPublicListing(db, listing.slug), status).toBeNull();
      expect((await search()).items.map((c) => c.id), status).toEqual([agencyListing.id]);
    }
  });
});
