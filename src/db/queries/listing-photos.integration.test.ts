import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import type { BasicsInput } from "@/lib/validation/listing";
import {
  addPhoto,
  canAddPhoto,
  deletePhoto,
  listPhotos,
  movePhoto,
  referencedBaseKeys,
  setCover,
  updatePhotoAlt,
} from "./listing-photos";
import { createDraft, deleteDraft, getPhotoSummary, submitListing, updateListing } from "./listings";

/**
 * Listing photos against the Neon test branch (TEST_DATABASE_URL). Most tests run in a transaction
 * that is rolled back; the race test commits its own fixtures on two connections and removes them.
 * Fixture ids (p_*, t_photo_*) differ from the other suites, which run in parallel: a shared unique
 * key would make their open transactions wait on each other.
 */
const url = process.env.TEST_DATABASE_URL;

const basics: BasicsInput = {
  title: "Modern 3-bedroom apartment in Kilimani",
  listingType: "rent",
  category: "apartment",
  county: "Nairobi",
  town: "Nairobi",
  neighbourhood: "Kilimani",
  priceKes: 85_000,
  rentPeriod: "month",
  bedrooms: 3,
};

const image = (listingId: string, n = 0) => ({
  baseKey: `listings/${listingId}/${randomUUID()}`,
  altText: `Living room view number ${n}`,
  width: 1600,
  height: 1200,
});

describe.skipIf(!url)("listing photos (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let starterPlanId: string;
  let verificationPlanId: string;
  let agencyId: string;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    starterPlanId = await one(
      `insert into plans (code, kind, name, price_kes, listing_limit) values ('t_photo_starter', 'listing', 'Starter', 1, 3) returning id`,
    );
    verificationPlanId = await one(
      `insert into plans (code, kind, name, price_kes) values ('t_photo_verify', 'verification', 'Verification', 1) returning id`,
    );
    agencyId = await one(`insert into agencies (name, slug) values ('Test Agency', 't-agency-photos') returning id`);
    await insertLister("p_owner", "member");
    await insertLister("p_admin", "admin");
    await insertLister("p_member", "member");
    await insertLister("p_solo");
    await insertLister("p_stranger");
    await insertLister("p_verified");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function one(statement: string, params: unknown[] = []): Promise<string> {
    return (await client.query<{ id: string }>(statement, params)).rows[0].id;
  }

  async function insertLister(id: string, agencyRole?: "admin" | "member") {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, agency_id) values ($1, $1, $2)`, [
      id,
      agencyRole ? agencyId : null,
    ]);
    if (agencyRole) {
      await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [agencyId, id, agencyRole]);
    }
  }

  async function givePlan(userId: string) {
    await client.query(
      `insert into subscriptions (owner_user_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at)
       values ($1, 'listing', $2, 'active', now() - interval '1 day', now() + interval '29 days', now() + interval '32 days')`,
      [userId, starterPlanId],
    );
  }

  async function makeVerified(userId: string) {
    await givePlan(userId);
    await client.query(
      `insert into verification_requests (lister_user_id, status, submitted_at, decided_at, review_expires_at)
       values ($1, 'verified', now(), now(), now() + interval '300 days')`,
      [userId],
    );
    await client.query(
      `insert into subscriptions (owner_user_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at)
       values ($1, 'verification', $2, 'active', now(), now() + interval '30 days', now() + interval '33 days')`,
      [userId, verificationPlanId],
    );
  }

  async function readyDraft(userId: string): Promise<string> {
    const { id } = await createDraft(db, userId, basics);
    await updateListing(db, userId, id, {
      description: "Bright corner unit with a balcony, lift, backup generator and secure parking.",
      bathrooms: 2,
    });
    return id;
  }

  async function setStatus(id: string, status: string) {
    await client.query(
      `update properties set status = $2::listing_status, published_at = now(),
         paused_at = case when $2::text = 'paused' then now() end,
         pause_reason = case when $2::text = 'paused' then 'plan_lapsed' end
       where id = $1`,
      [id, status],
    );
  }

  async function statusOf(id: string): Promise<string> {
    return (await client.query<{ status: string }>(`select status from properties where id = $1`, [id])).rows[0].status;
  }

  it("makes the first photo the cover, appends in order and stops at 20", async () => {
    const id = await readyDraft("p_solo");
    const first = await addPhoto(db, "p_solo", id, image(id, 1));
    expect(first).toMatchObject({ ok: true, status: "draft", returnedToReview: false });
    for (let n = 2; n <= 20; n++) expect((await addPhoto(db, "p_solo", id, image(id, n))).ok).toBe(true);

    const photos = await listPhotos(db, "p_solo", id);
    expect(photos?.map((p) => p.sortOrder)).toEqual([...Array(20).keys()]);
    expect(photos?.filter((p) => p.isCover).map((p) => p.altText)).toEqual(["Living room view number 1"]);
    expect(await addPhoto(db, "p_solo", id, image(id, 21))).toEqual({ ok: false, reason: "limit" });
    expect(await canAddPhoto(db, "p_solo", id)).toEqual({ ok: false, reason: "limit" });
  });

  it("lets the owner and their agency admin manage photos, but not a plain member or a stranger", async () => {
    const id = await readyDraft("p_owner");
    expect((await addPhoto(db, "p_admin", id, image(id))).ok).toBe(true);
    expect(await addPhoto(db, "p_member", id, image(id))).toEqual({ ok: false, reason: "not_found" });
    expect(await addPhoto(db, "p_stranger", id, image(id))).toEqual({ ok: false, reason: "not_found" });
    expect(await listPhotos(db, "p_stranger", id)).toBeNull();
    expect(await canAddPhoto(db, "p_stranger", id)).toEqual({ ok: false, reason: "not_found" });

    const [photo] = (await listPhotos(db, "p_owner", id))!;
    expect(await setCover(db, "p_stranger", id, photo.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await deletePhoto(db, "p_member", id, photo.id)).toEqual({ ok: false, reason: "not_found" });

    // A photo id from another listing is not reachable through this one.
    const other = await readyDraft("p_solo");
    await addPhoto(db, "p_solo", other, image(other));
    const [foreign] = (await listPhotos(db, "p_solo", other))!;
    expect(await deletePhoto(db, "p_owner", id, foreign.id)).toEqual({ ok: false, reason: "not_found" });
  });

  it("moves photos, changes the cover and updates descriptions", async () => {
    const id = await readyDraft("p_solo");
    for (const n of [1, 2, 3]) await addPhoto(db, "p_solo", id, image(id, n));
    const [a, b, c] = (await listPhotos(db, "p_solo", id))!;

    expect(await movePhoto(db, "p_solo", id, b.id, "up")).toEqual({ ok: true });
    expect((await listPhotos(db, "p_solo", id))!.map((p) => p.id)).toEqual([b.id, a.id, c.id]);
    expect(await movePhoto(db, "p_solo", id, b.id, "up")).toEqual({ ok: true });
    expect(await movePhoto(db, "p_solo", id, c.id, "down")).toEqual({ ok: true });
    expect((await listPhotos(db, "p_solo", id))!.map((p) => p.id)).toEqual([b.id, a.id, c.id]);

    expect(await setCover(db, "p_solo", id, c.id)).toEqual({ ok: true });
    const covers = (await listPhotos(db, "p_solo", id))!.filter((p) => p.isCover).map((p) => p.id);
    expect(covers).toEqual([c.id]);

    expect(await updatePhotoAlt(db, "p_solo", id, a.id, "Kitchen with island")).toEqual({ ok: true });
    expect((await listPhotos(db, "p_solo", id))!.find((p) => p.id === a.id)?.altText).toBe("Kitchen with island");
    await client.query("SAVEPOINT blank_alt");
    await expect(updatePhotoAlt(db, "p_solo", id, a.id, "   ")).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT blank_alt");
  });

  it("promotes the next photo when the cover is deleted and keeps the last photo on live listings", async () => {
    const id = await readyDraft("p_solo");
    for (const n of [1, 2]) await addPhoto(db, "p_solo", id, image(id, n));
    const [cover, second] = (await listPhotos(db, "p_solo", id))!;

    const removed = await deletePhoto(db, "p_solo", id, cover.id);
    expect(removed).toEqual({ ok: true, baseKey: cover.storageKey });
    expect(await listPhotos(db, "p_solo", id)).toMatchObject([{ id: second.id, isCover: true, sortOrder: 0 }]);

    await setStatus(id, "pending_review");
    expect(await deletePhoto(db, "p_solo", id, second.id)).toEqual({ ok: false, reason: "last_photo" });
    await client.query(`update properties set status = 'draft', published_at = null where id = $1`, [id]);
    expect((await deletePhoto(db, "p_solo", id, second.id)).ok).toBe(true);
    expect(await getPhotoSummary(db, id)).toEqual({ count: 0, hasCover: false, coverKey: null });
  });

  it("treats a new photo as a material edit for unverified owners only", async () => {
    const live = await readyDraft("p_solo");
    await addPhoto(db, "p_solo", live, image(live));
    await setStatus(live, "published");
    expect(await addPhoto(db, "p_solo", live, image(live))).toMatchObject({
      ok: true,
      status: "pending_review",
      returnedToReview: true,
    });

    const paused = await readyDraft("p_solo");
    await addPhoto(db, "p_solo", paused, image(paused));
    await setStatus(paused, "paused");
    expect(await addPhoto(db, "p_solo", paused, image(paused))).toMatchObject({ ok: true, status: "draft" });
    const row = await client.query(`select paused_at, pause_reason from properties where id = $1`, [paused]);
    expect(row.rows[0]).toEqual({ paused_at: null, pause_reason: null });

    // Reordering or editing descriptions never changes status.
    await setStatus(live, "published");
    const [first, second] = (await listPhotos(db, "p_solo", live))!;
    await movePhoto(db, "p_solo", live, second.id, "up");
    await setCover(db, "p_solo", live, second.id);
    await updatePhotoAlt(db, "p_solo", live, first.id, "Front of the building");
    expect(await statusOf(live)).toBe("published");

    await makeVerified("p_verified");
    const verified = await readyDraft("p_verified");
    await addPhoto(db, "p_verified", verified, image(verified));
    await setStatus(verified, "published");
    expect(await addPhoto(db, "p_verified", verified, image(verified))).toMatchObject({ ok: true, status: "published" });
  });

  it("requires a photo to submit, and returns photo keys when a draft is deleted", async () => {
    await givePlan("p_solo");
    const id = await readyDraft("p_solo");
    const blocked = await submitListing(db, "p_solo", id);
    expect(blocked).toEqual({ ok: false, reason: "invalid", errors: { photos: "Add at least one photo." } });

    await addPhoto(db, "p_solo", id, image(id));
    expect(await submitListing(db, "p_solo", id)).toEqual({ ok: true, status: "pending_review" });

    const draft = await readyDraft("p_solo");
    const a = image(draft, 1);
    const b = image(draft, 2);
    await addPhoto(db, "p_solo", draft, a);
    await addPhoto(db, "p_solo", draft, b);
    const deleted = await deleteDraft(db, "p_solo", draft);
    expect(deleted.ok && deleted.photoKeys?.sort()).toEqual([a.baseKey, b.baseKey].sort());
    expect(await referencedBaseKeys(db, [a.baseKey, b.baseKey])).toEqual(new Set());
  });
});

describe.skipIf(!url)("listing photos under concurrency (integration)", { timeout: 120_000 }, () => {
  it("never lets two parallel uploads pass the 20-photo limit", async () => {
    const setup = new Client({ connectionString: url });
    const first = new Client({ connectionString: url });
    const second = new Client({ connectionString: url });
    await Promise.all([setup.connect(), first.connect(), second.connect()]);
    const userId = `u_race_${Date.now()}`;
    try {
      const db = drizzle({ client: setup, schema }) as unknown as DbExecutor;
      await setup.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [userId]);
      await setup.query(`insert into lister_profiles (user_id, display_name) values ($1, $1)`, [userId]);
      const { id } = await createDraft(db, userId, basics);
      for (let n = 1; n <= 19; n++) await addPhoto(db, userId, id, image(id, n));

      const race = async (connection: Client) => {
        const tx = drizzle({ client: connection, schema }) as unknown as DbExecutor;
        await connection.query("BEGIN");
        try {
          const result = await addPhoto(tx, userId, id, image(id));
          await connection.query("COMMIT");
          return result;
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        }
      };
      const results = await Promise.all([race(first), race(second)]);
      expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
      expect((await getPhotoSummary(db, id)).count).toBe(20);
    } finally {
      await setup.query(`delete from properties where owner_user_id = $1`, [userId]);
      await setup.query(`delete from users where id = $1`, [userId]);
      await Promise.all([setup.end(), first.end(), second.end()]);
    }
  });
});
