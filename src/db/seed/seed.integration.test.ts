import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { getPublicListing } from "@/db/queries/listing-detail";
import { homeSections, searchListings, type PublicListingCard } from "@/db/queries/public-listings";
import {
  amountMismatches,
  multiplePayments,
  paidWithoutPayment,
  paymentInvoiceNotPaid,
  stuckPending,
} from "@/db/queries/reconciliation";
import * as schema from "@/db/schema";
import { DEFAULT_FILTERS, type SearchMode } from "@/lib/search/params";
import { createMemoryStore } from "@/test/memory-store";
import { SAMPLE_LISTINGS } from "./sample-data";
import { removeSampleData, seedSampleData, type SeedDeps } from "./seed";

/**
 * The sample seed against the Neon test branch (TEST_DATABASE_URL), inside one transaction that
 * is rolled back. Each lister's transaction is a savepoint. Fixtures use their own prefix,
 * `sample-t-`, so they can't collide with other suites.
 */
const url = process.env.TEST_DATABASE_URL;
const PREFIX = "sample-t-";
const ASSETS = path.join(process.cwd(), "scripts", "seed-assets");

const published = SAMPLE_LISTINGS.filter((l) => l.status === "published").map((l) => `${PREFIX}${l.key}`);
const hidden = SAMPLE_LISTINGS.filter((l) => l.status !== "published").map((l) => `${PREFIX}${l.key}`);
const verifiedListings = SAMPLE_LISTINGS.filter((l) => l.lister === "agent-wanjiru" || l.lister === "agent-otieno").map(
  (l) => `${PREFIX}${l.key}`,
);
const totalPhotos = SAMPLE_LISTINGS.reduce((sum, l) => sum + l.photos.length, 0);
/** Three WebP variants per photo, two per avatar, four avatars. */
const totalObjects = totalPhotos * 3 + 4 * 2;

describe.skipIf(!url)("sample seed (integration)", { timeout: 600_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  const store = createMemoryStore();
  const deps: SeedDeps = {
    db,
    withTransaction: async (fn) => {
      await client.query("SAVEPOINT seed_lister");
      try {
        const result = await fn(db);
        await client.query("RELEASE SAVEPOINT seed_lister");
        return result;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT seed_lister");
        throw error;
      }
    },
    publicStore: store,
    now: () => new Date(),
    readAsset: (name) => readFile(path.join(ASSETS, `${name}.webp`)),
  };
  const options = { prefix: PREFIX };
  let issuesBefore: number[];

  /** A real user, and one whose id looks like a sample but whose email is real: --remove must skip both. */
  const BYSTANDERS = [
    { id: "t-s11-real", email: "t-s11-real@example.test", slug: "t-s11-real-listing" },
    { id: "sample-t-imposter", email: "sample-t-imposter@real-domain.example", slug: "t-s11-imposter-listing" },
  ];

  beforeAll(async () => {
    await client.connect();
    await client.query("BEGIN");
    for (const b of BYSTANDERS) {
      await client.query(`insert into users (id, name, email) values ($1, $1, $2)`, [b.id, b.email]);
      await client.query(`insert into lister_profiles (user_id, display_name) values ($1, $1)`, [b.id]);
      await client.query(
        `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town, status, published_at)
         values ($1, $2, 'Bystander listing', 'A listing that the sample removal must never touch.', 'sale', 'land', 1000000, 'Nairobi', 'Nairobi', 'draft', null)`,
        [b.slug, b.id],
      );
    }
    issuesBefore = await reconciliationCounts();
  });
  afterAll(async () => {
    await client.query("ROLLBACK");
    await client.end();
  });

  async function count(statement: string, params: unknown[] = []): Promise<number> {
    return (await client.query<{ n: number }>(statement, params)).rows[0].n;
  }

  async function reconciliationCounts(): Promise<number[]> {
    const since = new Date(Date.now() - 35 * 86_400_000);
    // One client: run the checks one after another.
    const counts: number[] = [];
    counts.push((await paidWithoutPayment(db, since)).count);
    counts.push((await multiplePayments(db, since)).count);
    counts.push((await amountMismatches(db, since)).count);
    counts.push((await paymentInvoiceNotPaid(db, since)).count);
    counts.push((await stuckPending(db, since, new Date(Date.now() - 86_400_000))).count);
    return counts;
  }

  /** Every public card with the test prefix, across Buy and Rent (together: every listing). */
  async function publicSampleCards(): Promise<PublicListingCard[]> {
    const cards: PublicListingCard[] = [];
    for (const mode of ["buy", "rent"] satisfies SearchMode[]) {
      for (let page = 1; page <= 50; page++) {
        const result = await searchListings(db, { ...DEFAULT_FILTERS, mode, page });
        cards.push(...result.items);
        if (page >= result.pageCount) break;
      }
    }
    return cards.filter((card) => card.slug.startsWith(PREFIX));
  }

  async function verifiedSampleListers(): Promise<string[]> {
    const rows = await client.query<{ user_id: string }>(
      `select user_id from verified_listers_now where user_id like 'sample-t-%' order by user_id`,
    );
    return rows.rows.map((row) => row.user_id);
  }

  it("seeds 4 listers, 18 listings and their photos", async () => {
    const report = await seedSampleData(deps, options);
    expect(report.listers.map((l) => l.userId)).toEqual([
      "sample-t-agent-wanjiru",
      "sample-t-agent-otieno",
      "sample-t-agent-njoroge",
      "sample-t-owner-achieng",
    ]);
    expect(report.listers.every((l) => l.user === "inserted" && l.listingPlan === "paid")).toBe(true);
    expect(report.listers.reduce((sum, l) => sum + l.listingsInserted, 0)).toBe(18);
    expect(report.listers.reduce((sum, l) => sum + l.photos, 0)).toBe(totalPhotos);
    expect(store.objects.size).toBe(totalObjects);
  });

  it("shows exactly the 15 published listings in search, verified listers first", async () => {
    const cards = await publicSampleCards();
    expect(cards.map((c) => c.slug).sort()).toEqual([...published].sort());
    for (const card of cards) {
      expect(card.verified).toBe(verifiedListings.includes(card.slug));
      expect(card.coverKey).toMatch(/^listings\//);
      expect(card.listerAvatarKey).toMatch(/^avatars\/sample-t-/);
    }
    // Recommended puts the verified tier first (up to 3 per lister; Wanjiru's 4th rent listing drops back).
    const rent = (await searchListings(db, { ...DEFAULT_FILTERS, mode: "rent" })).items.filter((c) => c.slug.startsWith(PREFIX));
    const firstUnverified = rent.findIndex((c) => !c.verified);
    expect(firstUnverified).toBeGreaterThanOrEqual(3);
    expect(rent.slice(0, firstUnverified).every((c) => c.verified)).toBe(true);
  });

  it("never shows the draft, pending and rejected listings", async () => {
    const home = (await homeSections(db)).main;
    const homeSlugs = [...home.featured, ...home.newest].map((c) => c.slug);
    for (const slug of hidden) {
      expect(homeSlugs).not.toContain(slug);
      expect(await getPublicListing(db, slug)).toBeNull();
    }
    expect(await getPublicListing(db, published[0])).not.toBeNull();
  });

  it("derives the badge for exactly the two verified sample listers", async () => {
    expect(await verifiedSampleListers()).toEqual(["sample-t-agent-otieno", "sample-t-agent-wanjiru"]);
  });

  it("confirms every sample payment through the real flow, with no reconciliation issues", async () => {
    const rows = await client.query<{ status: string; invoice_status: string; receipt: string; raw: unknown; method: string }>(
      `select p.status, i.status as invoice_status, p.mpesa_receipt as receipt, p.raw_callback as raw, p.method
       from payments p join invoices i on i.id = p.invoice_id join subscriptions s on s.id = i.subscription_id
       where s.owner_user_id like 'sample-t-%'`,
    );
    expect(rows.rows).toHaveLength(6);
    for (const row of rows.rows) {
      expect(row).toMatchObject({ status: "confirmed", invoice_status: "paid", method: "manual", raw: { sample: true, source: "db:seed" } });
      expect(row.receipt).toMatch(/^SAMPLE\d{4,}$/);
    }
    const events = await count(
      `select count(*)::int as n from payment_events e join payments p on p.id = e.payment_id
       join invoices i on i.id = p.invoice_id join subscriptions s on s.id = i.subscription_id
       where s.owner_user_id like 'sample-t-%' and e.event_type = 'status_change'`,
    );
    expect(events).toBe(18);
    expect(await reconciliationCounts()).toEqual(issuesBefore);
  });

  it("inserts nothing on a second run", async () => {
    const report = await seedSampleData(deps, options);
    expect(report.plans.every((p) => p.result === "existing")).toBe(true);
    for (const lister of report.listers) {
      expect(lister).toMatchObject({ user: "existing", listingPlan: "existing", listingsInserted: 0, listingsExisting: expect.any(Number), photos: 0 });
      expect(["existing", "-"]).toContain(lister.verification);
    }
    expect(store.objects.size).toBe(totalObjects);
    expect(await count(`select count(*)::int as n from payments p where p.mpesa_receipt like 'SAMPLE%'`)).toBeGreaterThanOrEqual(6);
  });

  it("removes the sample data and nothing else", async () => {
    const report = await removeSampleData(deps, options);
    expect(report).toMatchObject({
      listers: 4,
      listingsDeleted: 18,
      listingsArchived: 0,
      avatarsCleared: 4,
      subscriptionsCancelled: 6,
      verificationsExpired: 2,
      storageErrors: 0,
    });
    expect(await publicSampleCards()).toEqual([]);
    expect(await verifiedSampleListers()).toEqual([]);
    expect(store.objects.size).toBe(0);
    for (const b of BYSTANDERS) {
      expect(await count(`select count(*)::int as n from properties where slug = $1`, [b.slug])).toBe(1);
      expect(await count(`select count(*)::int as n from users where id = $1`, [b.id])).toBe(1);
    }
  });

  it("restores everything when seeded again after removing", async () => {
    const report = await seedSampleData(deps, options);
    expect(report.listers.every((l) => l.user === "existing" && l.listingPlan === "paid")).toBe(true);
    expect(report.listers.reduce((sum, l) => sum + l.listingsInserted, 0)).toBe(18);
    expect(store.objects.size).toBe(totalObjects);
    expect((await publicSampleCards()).map((c) => c.slug).sort()).toEqual([...published].sort());
    expect(await verifiedSampleListers()).toEqual(["sample-t-agent-otieno", "sample-t-agent-wanjiru"]);
  });
});
