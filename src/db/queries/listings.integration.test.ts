import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { basicsFormValues, basicsSchema, type BasicsInput, type DetailsInput } from "@/lib/validation/listing";
import {
  createDraft,
  deleteDraft,
  getManageableListing,
  listManageableListings,
  submitListing,
  transitionListing,
  unpauseListing,
  updateListing,
} from "./listings";

/**
 * Lister listing workflow against the Neon test branch (TEST_DATABASE_URL). Every test runs in a
 * transaction that is rolled back. now() is fixed inside it, so plan periods are exact.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("listings (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let starterPlanId: string;
  let verificationPlanId: string;
  let agencyId: string;

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
  const details: Partial<DetailsInput> = {
    description: "Bright corner unit with a balcony, lift, backup generator and secure parking.",
    bathrooms: 2,
  };

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    starterPlanId = await one(
      `insert into plans (code, kind, name, price_kes, listing_limit) values ('t_starter', 'listing', 'Starter', 1, 3) returning id`,
    );
    verificationPlanId = await one(
      `insert into plans (code, kind, name, price_kes) values ('t_verify', 'verification', 'Verification', 1) returning id`,
    );
    agencyId = await one(`insert into agencies (name, slug) values ('Test Agency', 't-agency-listings') returning id`);
    await insertLister("u_owner", { agency: true });
    await insertLister("u_admin", { agency: true, agencyRole: "admin" });
    await insertLister("u_member", { agency: true, agencyRole: "member" });
    await insertLister("u_solo");
    await insertLister("u_stranger");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function one(statement: string, params: unknown[] = []): Promise<string> {
    const result = await client.query<{ id: string }>(statement, params);
    return result.rows[0].id;
  }

  async function insertLister(id: string, opts: { agency?: boolean; agencyRole?: "admin" | "member" } = {}) {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, agency_id) values ($1, $1, $2)`, [
      id,
      opts.agency ? agencyId : null,
    ]);
    if (opts.agencyRole) {
      await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [
        agencyId,
        id,
        opts.agencyRole,
      ]);
    }
  }

  /** An active plan whose period ends `endsIn` from now (grace is 3 days after). */
  async function givePlan(owner: { userId?: string; agencyId?: string }, endsIn = "10 days", planId = starterPlanId) {
    await client.query(
      `insert into subscriptions (owner_user_id, owner_agency_id, kind, plan_id, status,
         current_period_start, current_period_end, grace_ends_at)
       values ($1, $2, 'listing', $3, 'active',
         now() + $4::interval - interval '30 days', now() + $4::interval, now() + $4::interval + interval '3 days')`,
      [owner.userId ?? null, owner.agencyId ?? null, planId, endsIn],
    );
  }

  async function makeVerified(userId: string) {
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
    await updateListing(db, userId, id, details);
    return id;
  }

  async function statusOf(id: string): Promise<string> {
    const result = await client.query<{ status: string }>(`select status from properties where id = $1`, [id]);
    return result.rows[0].status;
  }

  it("creates drafts from validated basics only, copying the agency from the profile", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...basics, priceKes: "85,000", bedrooms: "3" })) {
      form.set(key, String(value));
    }
    form.set("status", "published");
    form.set("agencyId", "00000000-0000-0000-0000-000000000000");
    const input = basicsSchema.parse(basicsFormValues(form));
    const { id } = await createDraft(db, "u_owner", input);

    const row = await getManageableListing(db, "u_owner", id);
    expect(row).toMatchObject({ status: "draft", agencyId, ownerUserId: "u_owner", description: "", priceKes: 85_000 });
    expect(row?.slug).toMatch(/^modern-3-bedroom-apartment-in-kilimani-[0-9a-f]{6}$/);
    expect(row).not.toHaveProperty("exactLatitude");
  });

  it("lets the owner and their agency admin manage a listing, nobody else", async () => {
    const { id } = await createDraft(db, "u_owner", basics);
    expect(await getManageableListing(db, "u_owner", id)).not.toBeNull();
    expect(await getManageableListing(db, "u_admin", id)).not.toBeNull();
    expect(await getManageableListing(db, "u_member", id)).toBeNull();
    expect(await getManageableListing(db, "u_stranger", id)).toBeNull();
    expect(await getManageableListing(db, "u_owner", "not-a-uuid")).toBeNull();

    expect(await updateListing(db, "u_stranger", id, { title: "Hijacked listing title" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await updateListing(db, "u_admin", id, { priceKes: 90_000 })).toMatchObject({ ok: true });

    expect((await listManageableListings(db, "u_admin")).map((l) => l.id)).toContain(id);
    expect((await listManageableListings(db, "u_member")).map((l) => l.id)).not.toContain(id);
  });

  it("blocks submit without a plan and leaves the listing a draft", async () => {
    const id = await readyDraft("u_solo");
    const result = await submitListing(db, "u_solo", id);
    expect(result).toMatchObject({ ok: false, reason: "entitlement", entitlement: { reason: "no_plan" } });
    expect(await statusOf(id)).toBe("draft");
  });

  it("refuses to submit an incomplete draft, listing every missing field", async () => {
    await givePlan({ userId: "u_solo" });
    const { id } = await createDraft(db, "u_solo", { ...basics, title: "Flat" });
    const result = await submitListing(db, "u_solo", id);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (!result.ok && result.reason === "invalid") {
      expect(Object.keys(result.errors).sort()).toEqual(["bathrooms", "description", "title"]);
    }
  });

  it("sends an unverified lister's listing to review and publishes a verified lister's at once", async () => {
    await givePlan({ userId: "u_solo" });
    const id = await readyDraft("u_solo");
    expect(await submitListing(db, "u_solo", id)).toEqual({ ok: true, status: "pending_review" });

    await givePlan({ userId: "u_stranger" });
    await makeVerified("u_stranger");
    const verifiedId = await readyDraft("u_stranger");
    expect(await submitListing(db, "u_stranger", verifiedId)).toEqual({ ok: true, status: "published" });
    const row = await getManageableListing(db, "u_stranger", verifiedId);
    expect(row?.publishedAt).toBeInstanceOf(Date);
  });

  it("enforces the plan limit, counting listings in review", async () => {
    await givePlan({ userId: "u_solo" });
    for (let i = 0; i < 3; i++) {
      expect(await submitListing(db, "u_solo", await readyDraft("u_solo"))).toMatchObject({ ok: true });
    }
    const fourth = await readyDraft("u_solo");
    expect(await submitListing(db, "u_solo", fourth)).toMatchObject({
      ok: false,
      reason: "entitlement",
      entitlement: { reason: "limit_reached", limit: 3, activeListingCount: 3 },
    });
  });

  it("shares the agency's plan across members", async () => {
    await givePlan({ agencyId });
    // A personal plan does not count for an agency member.
    await givePlan({ userId: "u_member" });
    expect(await submitListing(db, "u_owner", await readyDraft("u_owner"))).toEqual({ ok: true, status: "pending_review" });
    expect(await submitListing(db, "u_member", await readyDraft("u_member"))).toMatchObject({ ok: true });
    expect(await submitListing(db, "u_admin", await readyDraft("u_admin"))).toMatchObject({ ok: true });
    // The agency's 3 slots are used across three members.
    expect(await submitListing(db, "u_member", await readyDraft("u_member"))).toMatchObject({
      ok: false,
      reason: "entitlement",
      entitlement: { reason: "limit_reached" },
    });
  });

  it("returns a published listing to review on a material edit by an unverified owner, not on a price edit", async () => {
    await givePlan({ userId: "u_solo" });
    const id = await readyDraft("u_solo");
    await client.query(`update properties set status = 'published', published_at = now() where id = $1`, [id]);

    expect(await updateListing(db, "u_solo", id, { priceKes: 90_000 })).toEqual({
      ok: true,
      status: "published",
      returnedToReview: false,
    });
    expect(await updateListing(db, "u_solo", id, { title: "Renovated 3-bedroom apartment in Kilimani" })).toEqual({
      ok: true,
      status: "pending_review",
      returnedToReview: true,
    });
  });

  it("keeps a verified owner's listing published after a material edit", async () => {
    await givePlan({ userId: "u_solo" });
    await makeVerified("u_solo");
    const id = await readyDraft("u_solo");
    await client.query(`update properties set status = 'published', published_at = now() where id = $1`, [id]);
    expect(await updateListing(db, "u_solo", id, { town: "Westlands" })).toMatchObject({ status: "published" });
  });

  it("clears fields that no longer apply when the category changes", async () => {
    const id = await readyDraft("u_solo");
    await updateListing(db, "u_solo", id, { category: "land", landSize: 0.5, landSizeUnit: "acre" });
    const row = await getManageableListing(db, "u_solo", id);
    expect(row).toMatchObject({ bedrooms: null, bathrooms: null, landSize: 0.5, landSizeUnit: "acre" });
  });

  it("un-pauses with a paid-up plan and refuses during grace", async () => {
    const id = await readyDraft("u_solo");
    await client.query(
      `update properties set status = 'paused', published_at = now(), paused_at = now(), pause_reason = 'plan_lapsed' where id = $1`,
      [id],
    );
    await givePlan({ userId: "u_solo" }, "-1 day");
    expect(await unpauseListing(db, "u_solo", id)).toMatchObject({
      ok: false,
      reason: "entitlement",
      entitlement: { reason: "plan_in_grace" },
    });

    await client.query(`update subscriptions set current_period_end = now() + interval '20 days',
      grace_ends_at = now() + interval '23 days' where owner_user_id = 'u_solo'`);
    expect(await unpauseListing(db, "u_solo", id)).toEqual({ ok: true, status: "published" });
    const row = await getManageableListing(db, "u_solo", id);
    expect(row).toMatchObject({ status: "published", pausedAt: null, pauseReason: null });
  });

  it("turns a paused listing into a draft on a material edit by an unverified owner", async () => {
    const id = await readyDraft("u_solo");
    const pause = `update properties set status = 'paused', published_at = now(), paused_at = now(),
      pause_reason = 'plan_lapsed' where id = $1`;
    await client.query(pause, [id]);
    expect(await updateListing(db, "u_solo", id, { priceKes: 90_000 })).toMatchObject({ status: "paused" });

    expect(await updateListing(db, "u_solo", id, { title: "Bright three bedroom flat in Kilimani" })).toEqual({
      ok: true,
      status: "draft",
      returnedToReview: true,
    });
    const row = await getManageableListing(db, "u_solo", id);
    expect(row).toMatchObject({ status: "draft", pausedAt: null, pauseReason: null });
    expect(await unpauseListing(db, "u_solo", id)).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("applies the lister transition rules", async () => {
    const id = await readyDraft("u_solo");
    await client.query(`update properties set status = 'published', published_at = now(),
      listing_type = 'sale', rent_period = null where id = $1`, [id]);
    expect(await transitionListing(db, "u_solo", id, "rented")).toEqual({ ok: false, reason: "not_allowed" });
    expect(await transitionListing(db, "u_solo", id, "sold")).toEqual({ ok: true, status: "sold" });
    expect(await transitionListing(db, "u_solo", id, "draft")).toEqual({ ok: false, reason: "not_allowed" });
    expect(await transitionListing(db, "u_solo", id, "archived")).toEqual({ ok: true, status: "archived" });
    expect(await updateListing(db, "u_solo", id, { priceKes: 1 })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("deletes never-submitted drafts only", async () => {
    const draft = await readyDraft("u_solo");
    expect(await deleteDraft(db, "u_stranger", draft)).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteDraft(db, "u_solo", draft)).toEqual({ ok: true, status: "draft" });
    expect(await getManageableListing(db, "u_solo", draft)).toBeNull();

    await givePlan({ userId: "u_solo" });
    const submitted = await readyDraft("u_solo");
    await submitListing(db, "u_solo", submitted);
    expect(await deleteDraft(db, "u_solo", submitted)).toEqual({ ok: false, reason: "not_allowed" });

    const reviewed = await readyDraft("u_solo");
    await client.query(`update properties set reviewed_at = now() where id = $1`, [reviewed]);
    expect(await deleteDraft(db, "u_solo", reviewed)).toEqual({ ok: false, reason: "not_allowed" });
  });
});
