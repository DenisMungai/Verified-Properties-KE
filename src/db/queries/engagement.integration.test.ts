import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { savedIdsAmong, setFavorite } from "./favorites";
import { createInquiry, getListingContact } from "./inquiries";
import { listConversations, unreadTotal } from "./messaging";
import { getPublicListing } from "./listing-detail";
import { savedListings, similarListings } from "./public-listings";
import { createReport } from "./reports";

/**
 * Detail page, saved listings, inquiries and reports against the Neon test branch
 * (TEST_DATABASE_URL). Every test runs in a transaction that is rolled back. Fixture ids are
 * prefixed s8e_ so parallel suites never share a unique key.
 */
const url = process.env.TEST_DATABASE_URL;

const EXACT_LATITUDE = -1.2876543;

describe.skipIf(!url)("engagement (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let agencyId: string;
  let slugCounter = 0;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    agencyId = await one(`insert into agencies (name, slug) values ('S8E Agency', 's8e-agency') returning id`);
    await insertUser("s8e_owner", { phone: "+254712000111", publicEmail: "owner@example.test" });
    await insertUser("s8e_agent", { agencyId });
    await insertUser("s8e_agency_admin", { agencyId, agencyRole: "admin" });
    await insertUser("s8e_buyer");
    await insertUser("s8e_other");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function one(statement: string, params: unknown[] = []): Promise<string> {
    return (await client.query<{ id: string }>(statement, params)).rows[0].id;
  }

  async function insertUser(
    id: string,
    opts: { agencyId?: string; agencyRole?: "admin" | "member"; phone?: string; publicEmail?: string } = {},
  ) {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    await client.query(
      `insert into lister_profiles (user_id, display_name, agency_id, phone, public_email) values ($1, $2, $3, $4, $5)`,
      [id, `Lister ${id}`, opts.agencyId ?? null, opts.phone ?? null, opts.publicEmail ?? null],
    );
    if (opts.agencyRole) {
      await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [opts.agencyId, id, opts.agencyRole]);
    }
  }

  async function insertListing(
    owner: string,
    opts: { status?: string; agencyId?: string; town?: string; county?: string; category?: string; listingType?: string; ageDays?: number; photos?: number } = {},
  ): Promise<{ id: string; slug: string }> {
    slugCounter += 1;
    const slug = `s8e-listing-${slugCounter}`;
    const listingType = opts.listingType ?? "sale";
    const id = await one(
      `insert into properties (slug, owner_user_id, agency_id, title, description, listing_type, category, price_kes,
         rent_period, county, town, neighbourhood, amenities, exact_latitude, exact_longitude, public_latitude, public_longitude,
         status, published_at, rejection_reason, pause_reason)
       values ($1, $2, $3, $4, 'A described listing used by the S8 tests.', $5, $6, 5000000,
         $7, $8, $9, 'Kilimani', '{Lift,Borehole}', $10, 36.78, -1.29, 36.78, $11,
         now() - make_interval(days => $12), null, $13)
       returning id`,
      [
        slug,
        owner,
        opts.agencyId ?? null,
        `S8E listing ${slugCounter}`,
        listingType,
        opts.category ?? "apartment",
        listingType === "rent" ? "month" : null,
        opts.county ?? "Nairobi",
        opts.town ?? "Nairobi",
        EXACT_LATITUDE,
        opts.status ?? "published",
        opts.ageDays ?? 1,
        opts.status === "paused" ? "plan_lapsed" : null,
      ],
    );
    for (let n = 0; n < (opts.photos ?? 0); n++) {
      await client.query(
        `insert into property_images (property_id, storage_key, alt_text, sort_order, is_cover) values ($1, $2, $3, $4, $5)`,
        [id, `listings/${id}/p${n}`, `Photo ${n + 1}`, n, n === 1],
      );
    }
    return { id, slug };
  }

  const inquiry = (message = "Hello, is this still available for viewing?") => ({
    fullName: "Buyer Person",
    phone: "+254711222333",
    email: null,
    message,
  });

  /* ---------------------------------------------------------------------- */
  /* Detail                                                                 */
  /* ---------------------------------------------------------------------- */

  it("returns a published listing with public fields only, cover photo first", async () => {
    const { slug } = await insertListing("s8e_owner", { photos: 3 });
    const result = await getPublicListing(db, slug);
    expect(result).not.toBeNull();
    expect(result!.ownerUserId).toBe("s8e_owner");
    const { listing } = result!;
    expect(listing).toMatchObject({ slug, listerName: "Lister s8e_owner", verified: false, amenities: ["Lift", "Borehole"] });
    expect(listing.photos.map((photo) => photo.altText)).toEqual(["Photo 2", "Photo 1", "Photo 3"]);
    const serialised = JSON.stringify(listing);
    expect(serialised).not.toContain(String(EXACT_LATITUDE));
    expect(serialised).not.toContain("s8e_owner@");
    for (const key of ["ownerUserId", "agencyId", "exactLatitude", "publicLatitude", "pauseReason", "rejectionReason", "reviewedBy"]) {
      expect(listing).not.toHaveProperty(key);
    }
  });

  it("returns null for every non-published status and for odd slugs", async () => {
    for (const status of ["draft", "pending_review", "paused", "rejected", "rented", "sold", "withdrawn", "archived"]) {
      const { slug } = await insertListing("s8e_owner", { status });
      expect(await getPublicListing(db, slug)).toBeNull();
    }
    expect(await getPublicListing(db, "../etc/passwd")).toBeNull();
  });

  it("finds similar listings: same type and category, same town first, never itself", async () => {
    const self = await insertListing("s8e_owner", { town: "Ruiru", county: "Kiambu" });
    const sameTown = await insertListing("s8e_other", { town: "Ruiru", county: "Kiambu", ageDays: 30 });
    const sameCounty = await insertListing("s8e_other", { town: "Thika", county: "Kiambu", ageDays: 2 });
    const elsewhere = await insertListing("s8e_other", { town: "Nairobi", county: "Nairobi", ageDays: 1 });
    await insertListing("s8e_other", { town: "Ruiru", county: "Kiambu", category: "house" });
    await insertListing("s8e_other", { town: "Ruiru", county: "Kiambu", listingType: "rent" });
    await insertListing("s8e_other", { town: "Ruiru", county: "Kiambu", status: "paused" });
    const similar = await similarListings(db, {
      id: self.id,
      listingType: "sale",
      category: "apartment",
      town: "Ruiru",
      county: "Kiambu",
    });
    expect(similar.map((card) => card.id)).toEqual([sameTown.id, sameCounty.id, elsewhere.id]);
  });

  /* ---------------------------------------------------------------------- */
  /* Saved                                                                  */
  /* ---------------------------------------------------------------------- */

  it("saves published listings only, idempotently, and unsaves anything", async () => {
    const live = await insertListing("s8e_owner");
    const paused = await insertListing("s8e_owner", { status: "paused" });
    expect(await setFavorite(db, "s8e_buyer", live.id, true)).toEqual({ ok: true, saved: true });
    expect(await setFavorite(db, "s8e_buyer", live.id, true)).toEqual({ ok: true, saved: true });
    expect(await setFavorite(db, "s8e_buyer", paused.id, true)).toEqual({ ok: false, reason: "unavailable" });
    expect(await setFavorite(db, "s8e_buyer", "not-a-uuid", true)).toEqual({ ok: false, reason: "unavailable" });
    expect(await savedIdsAmong(db, "s8e_buyer", [live.id, paused.id])).toEqual(new Set([live.id]));
    expect(await setFavorite(db, "s8e_buyer", live.id, false)).toEqual({ ok: true, saved: false });
    expect(await savedIdsAmong(db, "s8e_buyer", [live.id])).toEqual(new Set());
  });

  // Plan §12: "Buyer A cannot read Buyer B's … favorites" (prompt S19 decision 2.2).
  it("keeps each buyer's saved listings to themselves", async () => {
    const first = await insertListing("s8e_owner");
    const second = await insertListing("s8e_owner");
    await setFavorite(db, "s8e_buyer", first.id, true);
    await setFavorite(db, "s8e_buyer", second.id, true);

    expect(await savedListings(db, "s8e_other")).toEqual([]);
    expect(await savedIdsAmong(db, "s8e_other", [first.id, second.id])).toEqual(new Set());

    // Unsaving is scoped to the caller: another user's "unsave" leaves the buyer's saves alone.
    expect(await setFavorite(db, "s8e_other", first.id, false)).toEqual({ ok: true, saved: false });
    expect(await savedIdsAmong(db, "s8e_buyer", [first.id, second.id])).toEqual(new Set([first.id, second.id]));
    expect((await savedListings(db, "s8e_buyer")).map((card) => card.id).sort()).toEqual([first.id, second.id].sort());

    // Saving the same listing creates the other user's own row only.
    await setFavorite(db, "s8e_other", first.id, true);
    expect(await savedIdsAmong(db, "s8e_other", [first.id, second.id])).toEqual(new Set([first.id]));
    const { rows } = await client.query<{ user_id: string }>(`select user_id from favorites where property_id = $1 order by user_id`, [first.id]);
    expect(rows.map((r) => r.user_id)).toEqual(["s8e_buyer", "s8e_other"]);
  });

  it("lists saved listings that are still published, most recently saved first", async () => {
    const first = await insertListing("s8e_owner");
    const second = await insertListing("s8e_owner");
    await setFavorite(db, "s8e_buyer", first.id, true);
    await client.query(`update favorites set created_at = now() - interval '1 hour' where property_id = $1`, [first.id]);
    await setFavorite(db, "s8e_buyer", second.id, true);
    expect((await savedListings(db, "s8e_buyer")).map((card) => card.id)).toEqual([second.id, first.id]);
    await client.query(`update properties set status = 'paused' where id = $1`, [second.id]);
    expect((await savedListings(db, "s8e_buyer")).map((card) => card.id)).toEqual([first.id]);
    expect(await savedListings(db, "s8e_other")).toEqual([]);
  });

  /* ---------------------------------------------------------------------- */
  /* Inquiries                                                              */
  /* ---------------------------------------------------------------------- */

  it("creates an inquiry addressed to the owner", async () => {
    const { id } = await insertListing("s8e_owner");
    expect(await createInquiry(db, "s8e_buyer", id, inquiry())).toMatchObject({ ok: true });
    const rows = await client.query(`select sender_user_id, recipient_user_id, phone, message from inquiries where property_id = $1`, [id]);
    expect(rows.rows).toEqual([
      { sender_user_id: "s8e_buyer", recipient_user_id: "s8e_owner", phone: "+254711222333", message: inquiry().message },
    ]);
    expect(await getListingContact(db, id)).toEqual({
      lister: { phone: "+254712000111", whatsapp: null, email: "owner@example.test" },
      agency: null,
    });
  });

  it("returns an agency listing's office contacts next to the agent's", async () => {
    await client.query(`update agencies set public_phone = '+254722000444', whatsapp = '+254722000555', public_email = 'office@example.test' where id = $1`, [agencyId]);
    const { id } = await insertListing("s8e_agent", { agencyId });
    expect(await getListingContact(db, id)).toEqual({
      lister: { phone: null, whatsapp: null, email: null },
      agency: { name: "S8E Agency", phone: "+254722000444", whatsapp: "+254722000555", email: "office@example.test" },
    });
    await client.query(`update agencies set public_phone = null, whatsapp = null, public_email = null where id = $1`, [agencyId]);
    expect(await getListingContact(db, "not-a-uuid")).toEqual({ lister: { phone: null, whatsapp: null, email: null }, agency: null });
  });

  it("refuses own listings (owner or agency admin), unpublished listings, repeats and a 4th in a day", async () => {
    const agencyListing = await insertListing("s8e_agent", { agencyId });
    expect(await createInquiry(db, "s8e_agent", agencyListing.id, inquiry())).toEqual({ ok: false, reason: "own_listing" });
    expect(await createInquiry(db, "s8e_agency_admin", agencyListing.id, inquiry())).toEqual({ ok: false, reason: "own_listing" });

    const draft = await insertListing("s8e_owner", { status: "draft" });
    expect(await createInquiry(db, "s8e_buyer", draft.id, inquiry())).toEqual({ ok: false, reason: "unavailable" });

    const { id } = await insertListing("s8e_owner");
    expect(await createInquiry(db, "s8e_buyer", id, inquiry("First message about the flat."))).toMatchObject({ ok: true });
    expect(await createInquiry(db, "s8e_buyer", id, inquiry("First message about the flat."))).toEqual({ ok: false, reason: "duplicate" });
    expect(await createInquiry(db, "s8e_buyer", id, inquiry("Second message about the flat."))).toMatchObject({ ok: true });
    expect(await createInquiry(db, "s8e_buyer", id, inquiry("Third message about the flat."))).toMatchObject({ ok: true });
    expect(await createInquiry(db, "s8e_buyer", id, inquiry("Fourth message about the flat."))).toEqual({ ok: false, reason: "too_many" });
    // Older than 24 hours no longer counts.
    await client.query(`update inquiries set created_at = now() - interval '25 hours' where property_id = $1`, [id]);
    expect(await createInquiry(db, "s8e_buyer", id, inquiry("Fourth message about the flat."))).toMatchObject({ ok: true });
  });

  it("starts one conversation with the listing owner (not the agency admin) and reuses it", async () => {
    const agencyListing = await insertListing("s8e_agent", { agencyId });
    const first = await createInquiry(db, "s8e_buyer", agencyListing.id, inquiry("First message about the flat."));
    const second = await createInquiry(db, "s8e_buyer", agencyListing.id, inquiry("Second message about the flat."));
    expect(first.ok && second.ok && first.conversationId === second.conversationId).toBe(true);

    const [conversation] = await listConversations(db, "s8e_agent");
    expect(conversation).toMatchObject({ role: "lister", otherName: "s8e_buyer", unread: 2, lastExcerpt: "Second message about the flat." });
    expect(await unreadTotal(db, "s8e_agent")).toBe(2);
    expect(await listConversations(db, "s8e_agency_admin")).toEqual([]);
    expect(await listConversations(db, "s8e_other")).toEqual([]);
    expect(await listConversations(db, "s8e_buyer")).toMatchObject([{ role: "buyer", unread: 0, lastFromMe: true }]);
  });

  /* ---------------------------------------------------------------------- */
  /* Reports                                                                */
  /* ---------------------------------------------------------------------- */

  it("accepts one open report per person, never on your own or an unpublished listing", async () => {
    const { id } = await insertListing("s8e_owner");
    const input = { reason: "scam" as const, details: "Asked for a deposit before any viewing." };
    expect(await createReport(db, "s8e_buyer", id, input)).toMatchObject({ ok: true });
    expect(await createReport(db, "s8e_buyer", id, input)).toEqual({ ok: false, reason: "already_reported" });
    expect(await createReport(db, "s8e_other", id, input)).toMatchObject({ ok: true });
    expect(await createReport(db, "s8e_owner", id, input)).toEqual({ ok: false, reason: "own_listing" });
    const draft = await insertListing("s8e_owner", { status: "draft" });
    expect(await createReport(db, "s8e_buyer", draft.id, input)).toEqual({ ok: false, reason: "unavailable" });
    // After the report is resolved, the same person may report again.
    await client.query(`update listing_reports set status = 'dismissed' where property_id = $1`, [id]);
    expect(await createReport(db, "s8e_buyer", id, input)).toMatchObject({ ok: true });
  });
});
