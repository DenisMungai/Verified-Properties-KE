import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { cardSettingsFor } from "@/lib/card/config";
import type { EmailMessage } from "@/lib/email/send";
import { parseServerEnv } from "@/lib/env";
import { mpesaSettingsFor } from "@/lib/mpesa/config";
import { confirmPayment } from "@/lib/mpesa/confirm";
import { recordStkCallback } from "@/lib/mpesa/settle";
import { createMemoryLimiter } from "@/lib/rate-limit";
import type { SmsMessage, SmsTransport } from "@/lib/sms/send";
import { createFakeCardGateway, type FakeCardGateway } from "@/test/fake-card-gateway";
import { createFakeDaraja, type FakeDaraja } from "@/test/fake-daraja";
import { createMemoryStore } from "@/test/memory-store";
import { runGraceExpiry } from "./grace-expiry";
import { runPaymentChecks } from "./payment-checks";
import { runPlanChanges } from "./plan-changes";
import { runReconciliation } from "./reconciliation";
import { runRenewalReminders } from "./renewal-reminders";
import { runStorageCleanup } from "./storage-cleanup";
import type { JobDeps } from "./types";

/**
 * S9 jobs against the Neon test branch, with a movable clock, fake Daraja and card gateways and
 * recording email/SMS transports. Each test runs in a transaction that is rolled back. Jobs read
 * globally, so assertions are about this test's own rows. Plan codes (t_job_*) are unique to this
 * suite.
 */
const url = process.env.TEST_DATABASE_URL;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe.skipIf(!url)("Background jobs (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let clock: Date;
  let emails: EmailMessage[];
  let texts: SmsMessage[];
  let failEmails: number;
  let daraja: FakeDaraja;
  let gateway: FakeCardGateway;
  let deps: JobDeps;
  let starter: string;
  let pro: string;
  let agencyPlan: string;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    starter = await insertPlan("t_job_starter", 1000, 2);
    pro = await insertPlan("t_job_pro", 3000, 20);
    agencyPlan = await insertPlan("t_job_agency", 9000, 50, true);
    clock = new Date(Date.now() + HOUR);
    emails = [];
    texts = [];
    failEmails = 0;
    daraja = createFakeDaraja();
    gateway = createFakeCardGateway();
    const env = parseServerEnv({
      DATABASE_URL: "postgres://unused",
      MPESA_CALLBACK_TOKEN: "x".repeat(32),
      MPESA_CALLBACK_BASE_URL: "https://pay.example",
      PAYSTACK_SECRET_KEY: "sk_test_jobs",
    });
    const core = {
      db,
      withTransaction: <T,>(fn: (tx: DbExecutor) => Promise<T>) => fn(db),
      now: () => clock,
      rateLimiter: createMemoryLimiter(),
      email: async (message: EmailMessage) => {
        if (failEmails > 0) {
          failEmails -= 1;
          const error = new Error("down");
          error.name = "ResendDown";
          throw error;
        }
        emails.push(message);
      },
      appUrl: "https://app.example",
    };
    const sms: SmsTransport = async (message) => {
      texts.push(message);
      return { status: "sent" };
    };
    deps = {
      ...core,
      sms,
      payments: { ...core, daraja, settings: mpesaSettingsFor(env, "test")!, sleep: async () => {} },
      card: { ...core, gateway, settings: cardSettingsFor(env, "test")! },
      storage: { public: createMemoryStore(), private: createMemoryStore() },
      batchSize: 1000,
    };
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  /* ---------------------------------------------------------------------- */
  /* Fixtures                                                               */
  /* ---------------------------------------------------------------------- */

  async function one<T>(text: string, values: unknown[] = []): Promise<T> {
    const r = await client.query(text, values);
    return r.rows[0] as T;
  }

  async function insertPlan(code: string, price: number, limit: number, agency = false): Promise<string> {
    const row = await one<{ id: string }>(
      `insert into plans (code, kind, name, price_kes, listing_limit, is_agency_plan)
       values ($1, 'listing', initcap(replace($1, 't_job_', '')), $2, $3, $4) returning id`,
      [code, price, limit, agency],
    );
    return row.id;
  }

  async function insertAgency(slug: string): Promise<string> {
    return (await one<{ id: string }>(`insert into agencies (name, slug) values ($1, $1) returning id`, [slug])).id;
  }

  async function insertUser(id: string, opts: { agency?: { id: string; role: "admin" | "member" }; phone?: string } = {}) {
    await client.query(`insert into users (id, name, email) values ($1, $1 || ' Lister', $1 || '@jobs.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, agency_id, phone) values ($1, $1, $2, $3)`, [
      id,
      opts.agency?.id ?? null,
      opts.phone ?? null,
    ]);
    if (opts.agency) {
      await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [opts.agency.id, id, opts.agency.role]);
    }
    return id;
  }

  /** A paid subscription whose period ends at `periodEnd` (grace 3 days later). */
  async function insertSub(
    owner: { userId?: string; agencyId?: string },
    planId: string,
    periodEnd: Date,
    extra: { status?: string; scheduledPlanId?: string; scheduledChangeAt?: Date } = {},
  ): Promise<string> {
    const row = await one<{ id: string }>(
      `insert into subscriptions (owner_user_id, owner_agency_id, kind, plan_id, status, current_period_start,
         current_period_end, grace_ends_at, scheduled_plan_id, scheduled_change_at)
       values ($1, $2, 'listing', $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        owner.userId ?? null,
        owner.agencyId ?? null,
        planId,
        extra.status ?? "active",
        new Date(periodEnd.getTime() - 30 * DAY),
        periodEnd,
        new Date(periodEnd.getTime() + 3 * DAY),
        extra.scheduledPlanId ?? null,
        extra.scheduledChangeAt ?? null,
      ],
    );
    return row.id;
  }

  async function insertListing(ownerId: string, status: string, publishedDaysAgo: number | null, agencyId: string | null = null) {
    const row = await one<{ id: string }>(
      `insert into properties (slug, owner_user_id, agency_id, title, description, listing_type, category, price_kes,
         county, town, status, published_at)
       values (gen_random_uuid()::text, $1, $2, 'Test home', 'A test listing', 'sale', 'house', 1000000,
         'Nairobi', 'Nairobi', $3, case when $4::int is null then null else now() - make_interval(days => $4::int) end)
       returning id`,
      [ownerId, agencyId, status, publishedDaysAgo],
    );
    return row.id;
  }

  async function listing(id: string) {
    return one<{ status: string; pause_reason: string | null }>(`select status, pause_reason from properties where id = $1`, [id]);
  }

  async function sub(id: string) {
    return one<{ status: string; plan_id: string; scheduled_plan_id: string | null; current_period_end: Date }>(
      `select status, plan_id, scheduled_plan_id, current_period_end from subscriptions where id = $1`,
      [id],
    );
  }

  async function insertInvoice(subscriptionId: string, planId: string, amount: number, paid = false): Promise<{ id: string; number: string }> {
    const row = await one<{ id: string; invoice_number: string }>(
      `insert into invoices (subscription_id, plan_id, amount_kes, status, paid_at, period_start, period_end)
       values ($1, $2, $3, $4, $5, $6, $7) returning id, invoice_number`,
      paid
        ? [subscriptionId, planId, amount, "paid", clock, clock, new Date(clock.getTime() + 30 * DAY)]
        : [subscriptionId, planId, amount, "open", null, null, null],
    );
    return { id: row.id, number: row.invoice_number };
  }

  async function insertStkPayment(invoiceId: string, amount: number, createdAt: Date): Promise<{ id: string; checkout: string }> {
    const checkout = `ws_CO_JOB_${randomUUID()}`;
    const row = await one<{ id: string }>(
      `insert into payments (invoice_id, method, phone_e164, checkout_request_id, amount_kes, status, created_at, updated_at)
       values ($1, 'stk_push', '+254712345678', $2, $3, 'pending', $4, $4) returning id`,
      [invoiceId, checkout, amount, createdAt],
    );
    return { id: row.id, checkout };
  }

  async function paymentStatus(id: string) {
    return one<{ status: string; flag_reason: string | null }>(`select status, flag_reason from payments where id = $1`, [id]);
  }

  function stkPayload(checkoutRequestId: string, amount: number, receipt: string) {
    return {
      Body: {
        stkCallback: {
          MerchantRequestID: "m",
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 0,
          ResultDesc: "ok",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: amount },
              { Name: "MpesaReceiptNumber", Value: receipt },
              { Name: "PhoneNumber", Value: 254712345678 },
            ],
          },
        },
      },
    };
  }

  const receipt = () => `J${randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`;

  /* ---------------------------------------------------------------------- */
  /* Grace expiry and restore (Phase 1 exit criterion)                      */
  /* ---------------------------------------------------------------------- */

  it("pauses a lapsed plan's published listings, is a no-op when run again, and renewal restores them", async () => {
    const owner = await insertUser("job_lapse");
    const subId = await insertSub({ userId: owner }, starter, new Date(clock.getTime() - 3 * DAY - HOUR));
    const newer = await insertListing(owner, "published", 1);
    const older = await insertListing(owner, "published", 5);
    const pending = await insertListing(owner, "pending_review", null);

    const first = await runGraceExpiry(deps);
    expect(first.counts.pausedListingPlans).toBeGreaterThanOrEqual(1);
    expect((await sub(subId)).status).toBe("paused");
    expect(await listing(newer)).toEqual({ status: "paused", pause_reason: "plan_lapsed" });
    expect(await listing(older)).toEqual({ status: "paused", pause_reason: "plan_lapsed" });
    expect((await listing(pending)).status).toBe("pending_review");
    const events = await one<{ n: number }>(
      `select count(*)::int as n from payment_events where payload->>'subscriptionId' = $1 and payload->>'action' = 'grace_expired'`,
      [subId],
    );
    expect(events.n).toBe(1);

    await runGraceExpiry(deps);
    expect((await sub(subId)).status).toBe("paused");
    expect(
      (await one<{ n: number }>(`select count(*)::int as n from payment_events where payload->>'subscriptionId' = $1 and payload->>'action' = 'grace_expired'`, [subId])).n,
    ).toBe(1);

    // Renew: Starter allows 2 and the pending listing holds one slot, so only the newest returns.
    const invoice = await insertInvoice(subId, starter, 1000);
    const payment = await insertStkPayment(invoice.id, 1000, clock);
    const confirmed = await confirmPayment(db, payment.id, { receipt: receipt(), paidAmount: 1000, confirmedAt: clock });
    expect(confirmed.outcome).toBe("confirmed");
    const renewed = await sub(subId);
    expect(renewed.status).toBe("active");
    expect(new Date(renewed.current_period_end).getTime()).toBe(clock.getTime() + 30 * DAY);
    expect(await listing(newer)).toEqual({ status: "published", pause_reason: null });
    expect((await listing(older)).status).toBe("paused");
  });

  it("leaves plans in grace alone", async () => {
    const owner = await insertUser("job_grace");
    const subId = await insertSub({ userId: owner }, starter, new Date(clock.getTime() - DAY));
    const live = await insertListing(owner, "published", 2);
    await runGraceExpiry(deps);
    expect((await sub(subId)).status).toBe("active");
    expect((await listing(live)).status).toBe("published");
  });

  it("skips a subscription renewed between the candidate read and the lock", async () => {
    const owner = await insertUser("job_race");
    const subId = await insertSub({ userId: owner }, starter, new Date(clock.getTime() - 4 * DAY));
    const live = await insertListing(owner, "published", 2);
    const racing: JobDeps = {
      ...deps,
      withTransaction: async (fn) => {
        await client.query(
          `update subscriptions set current_period_end = $2, grace_ends_at = $3 where id = $1`,
          [subId, new Date(clock.getTime() + 30 * DAY), new Date(clock.getTime() + 33 * DAY)],
        );
        return fn(db);
      },
    };
    const result = await runGraceExpiry(racing);
    expect(result.counts.skipped).toBeGreaterThanOrEqual(1);
    expect((await sub(subId)).status).toBe("active");
    expect((await listing(live)).status).toBe("published");
  });

  it("pauses every member's listings in a lapsed agency pool and nobody else's", async () => {
    const agencyId = await insertAgency("job-agency");
    const admin = await insertUser("job_ag_admin", { agency: { id: agencyId, role: "admin" } });
    const member = await insertUser("job_ag_member", { agency: { id: agencyId, role: "member" } });
    const outsider = await insertUser("job_outsider");
    await insertSub({ agencyId }, agencyPlan, new Date(clock.getTime() - 4 * DAY));
    await insertSub({ userId: outsider }, starter, new Date(clock.getTime() + 10 * DAY));
    const a = await insertListing(admin, "published", 1, agencyId);
    const m = await insertListing(member, "published", 1, agencyId);
    const o = await insertListing(outsider, "published", 1);

    await runGraceExpiry(deps);
    expect((await listing(a)).status).toBe("paused");
    expect((await listing(m)).status).toBe("paused");
    expect((await listing(o)).status).toBe("published");
  });

  /* ---------------------------------------------------------------------- */
  /* Downgrades                                                             */
  /* ---------------------------------------------------------------------- */

  it("waits 3 days after a downgrade, then keeps the newest listings and applies the plan", async () => {
    const owner = await insertUser("job_down");
    const changeAt = new Date(clock.getTime() - 2 * DAY);
    const subId = await insertSub({ userId: owner }, pro, new Date(changeAt.getTime() + 30 * DAY), {
      scheduledPlanId: starter,
      scheduledChangeAt: changeAt,
    });
    const p1 = await insertListing(owner, "published", 1);
    const p2 = await insertListing(owner, "published", 3);
    const p3 = await insertListing(owner, "published", 9);
    const r1 = await insertListing(owner, "pending_review", null);
    const r2 = await insertListing(owner, "pending_review", null);

    await runPlanChanges(deps);
    expect((await sub(subId)).plan_id).toBe(pro);
    expect((await sub(subId)).scheduled_plan_id).toBe(starter);

    clock = new Date(changeAt.getTime() + 3 * DAY + MIN);
    await runPlanChanges(deps);
    const after = await sub(subId);
    expect(after.plan_id).toBe(starter);
    expect(after.scheduled_plan_id).toBeNull();
    expect((await listing(p1)).status).toBe("published");
    expect((await listing(p2)).status).toBe("published");
    expect(await listing(p3)).toEqual({ status: "paused", pause_reason: "over_plan_limit" });
    expect((await listing(r1)).status).toBe("draft");
    expect((await listing(r2)).status).toBe("draft");

    const again = await runPlanChanges(deps);
    expect(again.counts.applied ?? 0).toBe(0);
  });

  it("only applies the plan when the lister already chose", async () => {
    const owner = await insertUser("job_down_chosen");
    const changeAt = new Date(clock.getTime() - 4 * DAY);
    const subId = await insertSub({ userId: owner }, pro, new Date(changeAt.getTime() + 30 * DAY), {
      scheduledPlanId: starter,
      scheduledChangeAt: changeAt,
    });
    const kept = await insertListing(owner, "published", 1);
    await runPlanChanges(deps);
    expect((await sub(subId)).plan_id).toBe(starter);
    expect((await listing(kept)).status).toBe("published");
  });

  /* ---------------------------------------------------------------------- */
  /* Renewal reminders                                                      */
  /* ---------------------------------------------------------------------- */

  it("sends the 5-day and 1-day reminders once each, by email and SMS", async () => {
    const owner = await insertUser("job_remind", { phone: "+254712345678" });
    const periodEnd = new Date(clock.getTime() + 4.5 * DAY);
    const subId = await insertSub({ userId: owner }, starter, periodEnd);
    const mine = () => emails.filter((e) => e.to === "job_remind@jobs.test");

    await runRenewalReminders(deps);
    expect(mine()).toHaveLength(1);
    expect(mine()[0].subject).toBe("Your Starter plan ends in 5 days");
    expect(mine()[0].text).toContain("https://app.example/account/billing/checkout?plan=t_job_starter");
    expect(texts.filter((t) => t.to === "+254712345678")).toHaveLength(1);

    await runRenewalReminders(deps);
    expect(mine()).toHaveLength(1);

    clock = new Date(periodEnd.getTime() - 12 * HOUR);
    await runRenewalReminders(deps);
    expect(mine()).toHaveLength(2);
    expect(mine()[1].subject).toBe("Your Starter plan ends tomorrow");

    // An early renewal moves the period end: nothing more for the old one.
    await client.query(`update subscriptions set current_period_end = $2, grace_ends_at = $3 where id = $1`, [
      subId,
      new Date(periodEnd.getTime() + 30 * DAY),
      new Date(periodEnd.getTime() + 33 * DAY),
    ]);
    await runRenewalReminders(deps);
    expect(mine()).toHaveLength(2);
  });

  it("links to the scheduled plan, mails every agency admin, and retries a failed send", async () => {
    const agencyId = await insertAgency("job-remind-agency");
    await insertUser("job_rem_admin1", { agency: { id: agencyId, role: "admin" } });
    await insertUser("job_rem_admin2", { agency: { id: agencyId, role: "admin" } });
    await insertUser("job_rem_member", { agency: { id: agencyId, role: "member" } });
    const periodEnd = new Date(clock.getTime() + 3 * DAY);
    const subId = await insertSub({ agencyId }, agencyPlan, periodEnd, { scheduledPlanId: pro, scheduledChangeAt: periodEnd });
    const mine = () => emails.filter((e) => e.to.startsWith("job_rem_"));

    failEmails = 2;
    await runRenewalReminders(deps);
    expect(mine()).toHaveLength(0);
    const failed = await one<{ status: string; attempts: number; last_error: string }>(
      `select status, attempts, last_error from billing_reminders where subscription_id = $1 and channel = 'email'`,
      [subId],
    );
    expect(failed).toEqual({ status: "failed", attempts: 1, last_error: "ResendDown" });
    const smsRow = await one<{ status: string }>(`select status from billing_reminders where subscription_id = $1 and channel = 'sms'`, [subId]);
    expect(smsRow.status).toBe("skipped");

    await runRenewalReminders(deps);
    expect(mine().map((e) => e.to).sort()).toEqual(["job_rem_admin1@jobs.test", "job_rem_admin2@jobs.test"]);
    expect(mine()[0].text).toContain("plan=t_job_pro");
    expect((await one<{ attempts: number }>(`select attempts from billing_reminders where subscription_id = $1 and channel = 'email'`, [subId])).attempts).toBe(2);
  });

  /* ---------------------------------------------------------------------- */
  /* Payment checks                                                         */
  /* ---------------------------------------------------------------------- */

  it("settles, closes and flags pending payments without ever confirming without a receipt", async () => {
    const owner = await insertUser("job_pay");
    const subId = await insertSub({ userId: owner }, starter, new Date(clock.getTime() + 20 * DAY));
    const invoice = await insertInvoice(subId, starter, 1000);

    // Callback stored but never settled.
    const settled = await insertStkPayment(invoice.id, 1000, new Date(clock.getTime() - 10 * MIN));
    await recordStkCallback({ db }, { payload: stkPayload(settled.checkout, 1000, receipt()), sourceIp: null });
    await client.query(`update payments set updated_at = $2 where id = $1`, [settled.id, new Date(clock.getTime() - 5 * MIN)]);

    // No callback: cancelled by the payer; success but young; success and old.
    const cancelled = await insertStkPayment(invoice.id, 1000, new Date(clock.getTime() - 10 * MIN));
    daraja.queryResults.set(cancelled.checkout, [{ kind: "result", resultCode: 1032, resultDesc: "cancelled" }]);
    const young = await insertStkPayment(invoice.id, 1000, new Date(clock.getTime() - 20 * MIN));
    const old = await insertStkPayment(invoice.id, 1000, new Date(clock.getTime() - 40 * MIN));

    await runPaymentChecks(deps);
    expect((await paymentStatus(settled.id)).status).toBe("confirmed");
    expect((await paymentStatus(cancelled.id)).status).toBe("cancelled");
    expect((await paymentStatus(young.id)).status).toBe("pending");
    expect(await paymentStatus(old.id)).toEqual({ status: "flagged", flag_reason: "missing_receipt" });
  });

  it("closes a day-old abandoned card payment after one more Verify", async () => {
    const owner = await insertUser("job_card");
    const subId = await insertSub({ userId: owner }, starter, new Date(clock.getTime() + 20 * DAY));
    const invoice = await insertInvoice(subId, starter, 1000);
    const reference = `vpk_job_${randomUUID()}`;
    const row = await one<{ id: string }>(
      `insert into payments (invoice_id, method, provider_reference, amount_kes, status, result_desc, created_at)
       values ($1, 'card', $2, 1000, 'pending', 'abandoned', $3) returning id`,
      [invoice.id, reference, new Date(clock.getTime() - 25 * HOUR)],
    );
    gateway.verifyResults.set(reference, { status: "abandoned" });

    await runPaymentChecks(deps);
    expect(gateway.verifyCalls).toContain(reference);
    expect((await paymentStatus(row.id)).status).toBe("cancelled");
  });

  /* ---------------------------------------------------------------------- */
  /* Reconciliation and cleanup                                             */
  /* ---------------------------------------------------------------------- */

  it("reports each kind of mismatch with its ids in one reconciliation event", async () => {
    const owner = await insertUser("job_recon");
    const subId = await insertSub({ userId: owner }, starter, new Date(clock.getTime() + 20 * DAY));

    const orphanPaid = await insertInvoice(subId, starter, 1000, true);
    const mismatched = await insertInvoice(subId, starter, 1000, true);
    const wrong = await one<{ id: string }>(
      `insert into payments (invoice_id, method, mpesa_receipt, amount_kes, paid_amount_kes, status, confirmed_at)
       values ($1, 'c2b_paybill', $2, 1000, 900, 'confirmed', $3) returning id`,
      [mismatched.id, receipt(), clock],
    );
    const stuckInvoice = await insertInvoice(subId, starter, 1000);
    const stuck = await insertStkPayment(stuckInvoice.id, 1000, new Date(clock.getTime() - 2 * DAY));
    const unmatched = await one<{ id: string }>(
      `insert into payment_events (event_type, payload) values ('c2b_confirmation', '{"BillRefNumber":"NOPE"}') returning id`,
    );
    const before = await one<{ n: number }>(`select count(*)::int as n from payment_events where event_type = 'reconciliation'`);

    const result = await runReconciliation(deps);
    expect(result.ids?.paid_without_payment).toContain(orphanPaid.number);
    expect(result.ids?.paid_without_payment).not.toContain(mismatched.number);
    expect(result.ids?.amount_mismatch).toContain(wrong.id);
    expect(result.ids?.stuck_pending).toContain(stuck.id);
    expect(result.ids?.unmatched_paybill).toContain(unmatched.id);
    const after = await one<{ n: number }>(`select count(*)::int as n from payment_events where event_type = 'reconciliation'`);
    expect(after.n).toBe(before.n + 1);
    const report = await one<{ payload: { checks: Record<string, { count: number }> } }>(
      `select payload from payment_events where event_type = 'reconciliation' order by created_at desc limit 1`,
    );
    expect(report.payload.checks.amount_mismatch.count).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(report.payload)).not.toContain("254712345678");
  });

  it("sweeps only old orphaned uploads", async () => {
    const store = deps.storage!.private as ReturnType<typeof createMemoryStore>;
    const old = new Date(clock.getTime() - 2 * DAY);
    store.objects.set(`uploads/u/${randomUUID()}/a`, { body: Buffer.from("x"), contentType: "image/jpeg", lastModified: old });
    store.objects.set(`uploads/u/${randomUUID()}/b`, { body: Buffer.from("x"), contentType: "image/jpeg", lastModified: clock });
    const result = await runStorageCleanup(deps);
    expect(result.counts).toEqual({ uploadsDeleted: 1, imagesDeleted: 0 });
    expect(store.objects.size).toBe(1);
  });
});
