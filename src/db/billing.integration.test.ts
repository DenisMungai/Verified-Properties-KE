import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { countActiveListings, getPublishEntitlement, isListerVerified } from "@/db/queries/billing";
import * as schema from "@/db/schema";

/**
 * Checks the billing rules in drizzle/0002_billing.sql (constraints, triggers, the derived badge)
 * and the billing queries against a migrated database. Needs TEST_DATABASE_URL; skipped otherwise.
 * Every test runs inside a transaction that is rolled back, so it leaves no data behind. Inside
 * one transaction now() is fixed, so "now" offsets below are exact.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("billing schema and entitlements", { timeout: 30_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let listingPlanId: string;
  let verificationPlanId: string;
  let agencyPlanId: string;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    listingPlanId = await insertPlan({ code: "t_starter", kind: "listing", price_kes: 1, listing_limit: 3 });
    verificationPlanId = await insertPlan({ code: "t_verify", kind: "verification", price_kes: 1, listing_limit: null });
    agencyPlanId = await insertPlan({
      code: "t_agency",
      kind: "listing",
      price_kes: 3,
      listing_limit: 100,
      is_agency_plan: true,
    });
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function insertRow(table: string, row: Record<string, unknown>): Promise<string> {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const result = await client.query<{ id: string }>(
      `insert into ${table} (${columns.join(", ")}) values (${placeholders}) returning id`,
      Object.values(row),
    );
    return result.rows[0].id;
  }

  function insertPlan(row: Record<string, unknown>): Promise<string> {
    return insertRow("plans", { name: String(row.code), ...row });
  }

  /** Runs a statement that must fail, without aborting the surrounding transaction. */
  async function expectRejected(statement: string, params: unknown[] = []): Promise<void> {
    await client.query("SAVEPOINT expect_rejected");
    await expect(client.query(statement, params)).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT expect_rejected");
  }

  async function insertUser(id: string, { agencyId }: { agencyId?: string } = {}): Promise<string> {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    await client.query(
      `insert into lister_profiles (user_id, display_name, agency_id) values ($1, $1, $2)`,
      [id, agencyId ?? null],
    );
    return id;
  }

  async function insertAgency(slug: string): Promise<string> {
    return insertRow("agencies", { name: slug, slug });
  }

  /**
   * A paid subscription whose period ends `endsIn` from now (a Postgres interval, e.g. '10 days'
   * or '-1 day'); grace is 3 days after that.
   */
  async function insertSubscription(opts: {
    userId?: string;
    agencyId?: string;
    kind: "listing" | "verification";
    planId: string;
    status?: string;
    endsIn?: string;
  }): Promise<string> {
    const result = await client.query<{ id: string }>(
      `insert into subscriptions
         (owner_user_id, owner_agency_id, kind, plan_id, status,
          current_period_start, current_period_end, grace_ends_at)
       values ($1, $2, $3, $4, $5,
          now() + $6::interval - interval '30 days', now() + $6::interval, now() + $6::interval + interval '3 days')
       returning id`,
      [opts.userId ?? null, opts.agencyId ?? null, opts.kind, opts.planId, opts.status ?? "active", opts.endsIn ?? "10 days"],
    );
    return result.rows[0].id;
  }

  async function insertReview(userId: string, status = "verified", expiresIn = "200 days"): Promise<void> {
    await client.query(
      `insert into verification_requests (lister_user_id, status, submitted_at, decided_at, review_expires_at)
       values ($1, $2, now() - interval '1 day', now(), now() + $3::interval)`,
      [userId, status, expiresIn],
    );
  }

  async function insertInvoice(subscriptionId: string, planId: string, amount = 1): Promise<{ id: string; number: string }> {
    const result = await client.query<{ id: string; invoice_number: string }>(
      `insert into invoices (subscription_id, plan_id, amount_kes) values ($1, $2, $3) returning id, invoice_number`,
      [subscriptionId, planId, amount],
    );
    return { id: result.rows[0].id, number: result.rows[0].invoice_number };
  }

  async function verifiedNow(userId: string): Promise<boolean> {
    const result = await client.query<{ v: boolean }>("select lister_verified_now($1) as v", [userId]);
    return result.rows[0].v;
  }

  /* ---------------------------------------------------------------------- */
  /* Plans                                                                  */
  /* ---------------------------------------------------------------------- */

  it("keeps plan terms immutable but allows renaming", async () => {
    await expectRejected(`update plans set price_kes = 5 where id = $1`, [listingPlanId]);
    await expectRejected(`update plans set listing_limit = 10 where id = $1`, [listingPlanId]);
    await expectRejected(`update plans set kind = 'verification', listing_limit = null where id = $1`, [listingPlanId]);
    await client.query(`update plans set name = 'Starter plan', is_active = false where id = $1`, [listingPlanId]);
  });

  it("allows only one active version per plan code", async () => {
    await expectRejected(
      `insert into plans (code, version, kind, name, price_kes, listing_limit) values ('t_starter', 2, 'listing', 'x', 5, 3)`,
    );
    await client.query(`update plans set is_active = false where id = $1`, [listingPlanId]);
    await insertPlan({ code: "t_starter", version: 2, kind: "listing", price_kes: 5, listing_limit: 3 });
  });

  it("requires a listing limit exactly for listing plans", async () => {
    await expectRejected(
      `insert into plans (code, kind, name, price_kes, listing_limit) values ('t_bad1', 'verification', 'x', 1, 3)`,
    );
    await expectRejected(`insert into plans (code, kind, name, price_kes) values ('t_bad2', 'listing', 'x', 1)`);
    await expectRejected(
      `insert into plans (code, kind, name, price_kes, listing_limit) values ('t_bad3', 'listing', 'x', -1, 3)`,
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Subscriptions                                                          */
  /* ---------------------------------------------------------------------- */

  it("requires exactly one owner, and only listing plans for agencies", async () => {
    const userId = await insertUser("u_owner");
    const agencyId = await insertAgency("t-agency-owner");
    await expectRejected(
      `insert into subscriptions (owner_user_id, owner_agency_id, kind, plan_id) values ($1, $2, 'listing', $3)`,
      [userId, agencyId, listingPlanId],
    );
    await expectRejected(`insert into subscriptions (kind, plan_id) values ('listing', $1)`, [listingPlanId]);
    await expectRejected(
      `insert into subscriptions (owner_agency_id, kind, plan_id) values ($1, 'verification', $2)`,
      [agencyId, verificationPlanId],
    );
  });

  it("keeps the subscription kind in step with its plan", async () => {
    const userId = await insertUser("u_kind");
    await expectRejected(
      `insert into subscriptions (owner_user_id, kind, plan_id) values ($1, 'listing', $2)`,
      [userId, verificationPlanId],
    );
  });

  it("allows one live subscription per owner and kind", async () => {
    const userId = await insertUser("u_live");
    const first = await insertSubscription({ userId, kind: "listing", planId: listingPlanId });
    await expectRejected(
      `insert into subscriptions (owner_user_id, kind, plan_id) values ($1, 'listing', $2)`,
      [userId, listingPlanId],
    );
    // A verification subscription alongside is fine.
    await insertSubscription({ userId, kind: "verification", planId: verificationPlanId });
    await client.query(`update subscriptions set status = 'expired' where id = $1`, [first]);
    await client.query(`insert into subscriptions (owner_user_id, kind, plan_id) values ($1, 'listing', $2)`, [
      userId,
      listingPlanId,
    ]);
  });

  it("requires a period for paid statuses", async () => {
    const userId = await insertUser("u_period");
    await expectRejected(
      `insert into subscriptions (owner_user_id, kind, plan_id, status) values ($1, 'listing', $2, 'active')`,
      [userId, listingPlanId],
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Invoices and payments                                                  */
  /* ---------------------------------------------------------------------- */

  it("numbers invoices VPK + 7 digits, increasing, with immutable terms", async () => {
    const userId = await insertUser("u_invoice");
    const subscriptionId = await insertSubscription({ userId, kind: "listing", planId: listingPlanId });
    const a = await insertInvoice(subscriptionId, listingPlanId);
    const b = await insertInvoice(subscriptionId, listingPlanId);
    expect(a.number).toMatch(/^VPK\d{7}$/);
    expect(b.number).toMatch(/^VPK\d{7}$/);
    expect(Number(b.number.slice(3))).toBeGreaterThan(Number(a.number.slice(3)));

    await expectRejected(`update invoices set amount_kes = 2 where id = $1`, [a.id]);
    await expectRejected(`update invoices set invoice_number = 'VPK9999999' where id = $1`, [a.id]);
    await expectRejected(`insert into invoices (subscription_id, plan_id, amount_kes) values ($1, $2, 0)`, [
      subscriptionId,
      listingPlanId,
    ]);
    // Status may move on; a paid invoice needs its period and paid time.
    await expectRejected(`update invoices set status = 'paid' where id = $1`, [a.id]);
    await client.query(
      `update invoices set status = 'paid', paid_at = now(), period_start = now(), period_end = now() + interval '30 days'
       where id = $1`,
      [a.id],
    );
  });

  it("keeps checkout ids and receipts unique and confirmed payments complete", async () => {
    const userId = await insertUser("u_payment");
    const subscriptionId = await insertSubscription({ userId, kind: "listing", planId: listingPlanId });
    const invoice = await insertInvoice(subscriptionId, listingPlanId);
    const pay = (extra: Record<string, unknown>) =>
      insertRow("payments", { invoice_id: invoice.id, method: "stk_push", amount_kes: 1, ...extra });

    await pay({ checkout_request_id: "ws_CO_TEST_1", mpesa_receipt: "TST0000001" });
    await expectRejected(
      `insert into payments (invoice_id, method, amount_kes, checkout_request_id) values ($1, 'stk_push', 1, 'ws_CO_TEST_1')`,
      [invoice.id],
    );
    await expectRejected(
      `insert into payments (invoice_id, method, amount_kes, mpesa_receipt) values ($1, 'c2b_paybill', 1, 'TST0000001')`,
      [invoice.id],
    );
    await expectRejected(`insert into payments (invoice_id, method, amount_kes) values ($1, 'stk_push', 1)`, [
      invoice.id,
    ]);
    await expectRejected(
      `insert into payments (invoice_id, method, amount_kes, checkout_request_id, status) values ($1, 'stk_push', 1, 'ws_CO_TEST_2', 'confirmed')`,
      [invoice.id],
    );
    await expectRejected(
      `insert into payments (invoice_id, method, amount_kes, checkout_request_id, status) values ($1, 'stk_push', 1, 'ws_CO_TEST_3', 'flagged')`,
      [invoice.id],
    );
    await expectRejected(
      `insert into payments (invoice_id, method, amount_kes, checkout_request_id) values ($1, 'stk_push', -1, 'ws_CO_TEST_4')`,
      [invoice.id],
    );
    // Two C2B payments without a checkout id are fine (nulls are not duplicates).
    await pay({ method: "c2b_paybill", mpesa_receipt: "TST0000002" });
    await pay({ method: "c2b_paybill", mpesa_receipt: "TST0000003" });
  });

  it("makes payment_events and billing_audit_log append-only", async () => {
    const userId = await insertUser("u_audit");
    const eventId = await insertRow("payment_events", {
      event_type: "stk_callback",
      payload: JSON.stringify({ unmatched: true }),
    });
    await expectRejected(`update payment_events set event_type = 'x' where id = $1`, [eventId]);
    await expectRejected(`delete from payment_events where id = $1`, [eventId]);

    const auditId = await insertRow("billing_audit_log", {
      actor_user_id: userId,
      action: "credit",
      amount_kes: 1,
      reason: "Test credit",
    });
    await expectRejected(`update billing_audit_log set reason = 'changed' where id = $1`, [auditId]);
    await expectRejected(`delete from billing_audit_log where id = $1`, [auditId]);
    await expectRejected(
      `insert into billing_audit_log (actor_user_id, action, reason) values ($1, 'credit', '   ')`,
      [userId],
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Derived badge                                                          */
  /* ---------------------------------------------------------------------- */

  describe("lister_verified_now", () => {
    async function fullyVerified(id: string): Promise<string> {
      const userId = await insertUser(id);
      await insertReview(userId);
      await insertSubscription({ userId, kind: "verification", planId: verificationPlanId });
      await insertSubscription({ userId, kind: "listing", planId: listingPlanId });
      return userId;
    }

    it("is true with a passed review and both subscriptions paid", async () => {
      const userId = await fullyVerified("u_v_full");
      expect(await verifiedNow(userId)).toBe(true);
      expect(await isListerVerified(db, userId)).toBe(true);
    });

    it("stays true while either subscription is in grace", async () => {
      const a = await insertUser("u_v_grace_verification");
      await insertReview(a);
      await insertSubscription({ userId: a, kind: "verification", planId: verificationPlanId, endsIn: "-1 day" });
      await insertSubscription({ userId: a, kind: "listing", planId: listingPlanId });
      expect(await verifiedNow(a)).toBe(true);

      const b = await insertUser("u_v_grace_listing");
      await insertReview(b);
      await insertSubscription({ userId: b, kind: "verification", planId: verificationPlanId });
      await insertSubscription({ userId: b, kind: "listing", planId: listingPlanId, status: "past_due", endsIn: "-2 days" });
      expect(await verifiedNow(b)).toBe(true);
    });

    it("uses the agency's listing plan for agency members", async () => {
      const agencyId = await insertAgency("t-agency-badge");
      const userId = await insertUser("u_v_agency", { agencyId });
      await insertReview(userId);
      await insertSubscription({ userId, kind: "verification", planId: verificationPlanId });
      expect(await verifiedNow(userId)).toBe(false);
      await insertSubscription({ agencyId, kind: "listing", planId: agencyPlanId });
      expect(await verifiedNow(userId)).toBe(true);
    });

    it("ignores an agency member's personal listing plan", async () => {
      const agencyId = await insertAgency("t-agency-personal");
      const userId = await insertUser("u_v_agency_personal", { agencyId });
      await insertReview(userId);
      await insertSubscription({ userId, kind: "verification", planId: verificationPlanId });
      await insertSubscription({ userId, kind: "listing", planId: listingPlanId });
      expect(await verifiedNow(userId)).toBe(false);
    });

    it("is false without a passed, unexpired, unsuspended review", async () => {
      const noReview = await insertUser("u_v_no_review");
      await insertSubscription({ userId: noReview, kind: "verification", planId: verificationPlanId });
      await insertSubscription({ userId: noReview, kind: "listing", planId: listingPlanId });
      expect(await verifiedNow(noReview)).toBe(false);

      const paidOnly = await insertUser("u_v_paid_only");
      await client.query(
        `insert into verification_requests (lister_user_id, status, submitted_at) values ($1, 'under_review', now())`,
        [paidOnly],
      );
      await insertSubscription({ userId: paidOnly, kind: "verification", planId: verificationPlanId });
      await insertSubscription({ userId: paidOnly, kind: "listing", planId: listingPlanId });
      expect(await verifiedNow(paidOnly)).toBe(false);

      const expired = await insertUser("u_v_expired");
      await insertReview(expired, "verified", "-1 day");
      await insertSubscription({ userId: expired, kind: "verification", planId: verificationPlanId });
      await insertSubscription({ userId: expired, kind: "listing", planId: listingPlanId });
      expect(await verifiedNow(expired)).toBe(false);

      const suspended = await fullyVerified("u_v_suspended");
      await client.query(`update verification_requests set status = 'suspended' where lister_user_id = $1`, [suspended]);
      expect(await verifiedNow(suspended)).toBe(false);
    });

    it("is false once either subscription is past grace or stopped", async () => {
      const lapsedVerification = await insertUser("u_v_lapsed_verification");
      await insertReview(lapsedVerification);
      await insertSubscription({
        userId: lapsedVerification,
        kind: "verification",
        planId: verificationPlanId,
        endsIn: "-4 days",
      });
      await insertSubscription({ userId: lapsedVerification, kind: "listing", planId: listingPlanId });
      expect(await verifiedNow(lapsedVerification)).toBe(false);

      const lapsedListing = await insertUser("u_v_lapsed_listing");
      await insertReview(lapsedListing);
      await insertSubscription({ userId: lapsedListing, kind: "verification", planId: verificationPlanId });
      await insertSubscription({ userId: lapsedListing, kind: "listing", planId: listingPlanId, endsIn: "-4 days" });
      expect(await verifiedNow(lapsedListing)).toBe(false);

      const paused = await fullyVerified("u_v_paused");
      await client.query(`update subscriptions set status = 'paused' where owner_user_id = $1 and kind = 'listing'`, [
        paused,
      ]);
      expect(await verifiedNow(paused)).toBe(false);
    });

    it("is false for unknown users", async () => {
      expect(await verifiedNow("u_does_not_exist")).toBe(false);
      expect(await isListerVerified(db, "u_does_not_exist")).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Listing pool and entitlement queries                                   */
  /* ---------------------------------------------------------------------- */

  async function insertListing(ownerUserId: string, status: string, agencyId?: string): Promise<void> {
    await insertRow("properties", {
      slug: `t-${Math.random().toString(36).slice(2)}`,
      owner_user_id: ownerUserId,
      agency_id: agencyId ?? null,
      title: "Test listing",
      description: "Test listing",
      listing_type: "sale",
      category: "house",
      price_kes: 1_000_000,
      county: "Nairobi",
      town: "Kilimani",
      status,
    });
  }

  it("counts an agency's published and pending listings across members", async () => {
    const agencyId = await insertAgency("t-agency-count");
    const a = await insertUser("u_pool_a", { agencyId });
    const b = await insertUser("u_pool_b", { agencyId });
    await insertListing(a, "published", agencyId);
    await insertListing(b, "pending_review", agencyId);
    await insertListing(b, "paused", agencyId);
    await insertListing(a, "draft", agencyId);
    await insertListing(a, "sold", agencyId);

    expect(await countActiveListings(db, { kind: "agency", agencyId })).toBe(2);
    expect(await countActiveListings(db, { kind: "user", userId: a })).toBe(1);
  });

  it("decides publishing from the pool's plan and count", async () => {
    const userId = await insertUser("u_entitle");
    expect(await getPublishEntitlement(db, userId)).toMatchObject({ ok: false, reason: "no_plan" });

    await insertSubscription({ userId, kind: "listing", planId: listingPlanId });
    await insertListing(userId, "published");
    await insertListing(userId, "pending_review");
    expect(await getPublishEntitlement(db, userId)).toMatchObject({ ok: true, limit: 3, remaining: 1 });

    await insertListing(userId, "published");
    expect(await getPublishEntitlement(db, userId)).toMatchObject({ ok: false, reason: "limit_reached" });
  });

  it("shares the agency limit and blocks members during the agency plan's grace", async () => {
    const agencyId = await insertAgency("t-agency-entitle");
    const member = await insertUser("u_entitle_member", { agencyId });
    await insertSubscription({ agencyId, kind: "listing", planId: agencyPlanId, endsIn: "-1 day" });
    expect(await getPublishEntitlement(db, member)).toMatchObject({ ok: false, reason: "plan_in_grace" });
  });
});
