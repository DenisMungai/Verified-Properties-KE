import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { parseServerEnv } from "@/lib/env";
import { createMemoryLimiter } from "@/lib/rate-limit";
import { createFakeDaraja, type FakeDaraja } from "@/test/fake-daraja";
import { confirmC2b, recordC2bConfirmation, validateC2b } from "./c2b";
import { mpesaSettingsFor } from "./config";
import type { PaymentDeps } from "./deps";
import { recordStkCallback, settleStkPayment } from "./settle";
import { startPlanPayment } from "./start-payment";

/**
 * The S5 payment flow against the Neon test branch (TEST_DATABASE_URL) with a fake Daraja client
 * and a movable clock. Each test runs in a transaction that is rolled back. Plan codes (t_pay_*)
 * differ from the other suites, which run in parallel against the same unique indexes.
 */
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;
const PHONE = "0712345678";

describe.skipIf(!url)("M-Pesa payments (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let daraja: FakeDaraja;
  let clock: Date;
  let deps: PaymentDeps;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    await insertPlan({ code: "t_pay_starter", name: "Starter", price_kes: 2, listing_limit: 3 });
    await insertPlan({ code: "t_pay_pro", name: "Pro", price_kes: 5, listing_limit: 20 });
    await insertPlan({ code: "t_pay_agency", name: "Agency", price_kes: 9, listing_limit: 100, is_agency_plan: true });
    await insertPlan({ code: "t_pay_verify", name: "Verify", kind: "verification", price_kes: 1, listing_limit: null });
    daraja = createFakeDaraja();
    clock = new Date();
    deps = {
      db,
      withTransaction: (fn) => fn(db),
      daraja,
      settings: mpesaSettingsFor(
        parseServerEnv({
          DATABASE_URL: "postgres://unused",
          MPESA_CALLBACK_TOKEN: "x".repeat(32),
          MPESA_CALLBACK_BASE_URL: "https://pay.example",
        }),
        "test",
      )!,
      now: () => clock,
      rateLimiter: createMemoryLimiter(),
      email: async () => {},
      appUrl: "https://app.example",
      sleep: async () => {},
    };
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  /* ---------------------------------------------------------------------- */
  /* Fixtures                                                               */
  /* ---------------------------------------------------------------------- */

  async function insertPlan(row: Record<string, unknown>): Promise<void> {
    const values = { kind: "listing", ...row };
    const columns = Object.keys(values);
    await client.query(
      `insert into plans (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(values),
    );
  }

  async function insertUser(id: string, agency?: { id: string; role: "admin" | "member" }): Promise<string> {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@pay.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, agency_id) values ($1, $1, $2)`, [
      id,
      agency?.id ?? null,
    ]);
    if (agency) {
      await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [
        agency.id,
        id,
        agency.role,
      ]);
    }
    return id;
  }

  async function insertAgency(slug: string): Promise<string> {
    const r = await client.query<{ id: string }>(`insert into agencies (name, slug) values ($1, $1) returning id`, [slug]);
    return r.rows[0].id;
  }

  async function insertListing(
    ownerId: string,
    opts: { status: string; publishedDaysAgo?: number; pauseReason?: string | null },
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes,
         county, town, status, published_at, paused_at, pause_reason)
       values (gen_random_uuid()::text, $1, 'Test home', 'A test listing', 'sale', 'house', 1000000,
         'Nairobi', 'Nairobi', $2, now() - make_interval(days => $3), $4, $5)
       returning id`,
      [
        ownerId,
        opts.status,
        opts.publishedDaysAgo ?? 1,
        opts.status === "paused" ? new Date() : null,
        opts.status === "paused" ? (opts.pauseReason ?? "plan_lapsed") : null,
      ],
    );
    return r.rows[0].id;
  }

  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
    (await client.query<T>(sql, params)).rows[0];

  const subscriptionOf = (column: "owner_user_id" | "owner_agency_id", owner: string) =>
    one<{ id: string; status: string; current_period_start: Date | null; current_period_end: Date | null; grace_ends_at: Date | null }>(
      `select * from subscriptions where ${column} = $1 and status in ('pending','active','past_due','paused')`,
      [owner],
    );

  const payment = (id: string) =>
    one<{ status: string; flag_reason: string | null; mpesa_receipt: string | null; paid_amount_kes: number | null }>(
      `select * from payments where id = $1`,
      [id],
    );

  const invoice = (number: string) =>
    one<{ id: string; status: string; amount_kes: number; period_start: Date | null; period_end: Date | null }>(
      `select * from invoices where invoice_number = $1`,
      [number],
    );

  async function start(userId: string, planCode = "t_pay_starter", phone = PHONE) {
    return startPlanPayment(deps, { userId, planCode, phone });
  }

  async function startOk(userId: string, planCode = "t_pay_starter") {
    const result = await start(userId, planCode);
    if (!result.ok) throw new Error(`start failed: ${result.code}`);
    return result;
  }

  function stkPayload(checkoutRequestId: string, { code = 0, amount = 2, receipt = "TST0000001" } = {}) {
    return {
      Body: {
        stkCallback: {
          MerchantRequestID: "m",
          CheckoutRequestID: checkoutRequestId,
          ResultCode: code,
          ResultDesc: code === 0 ? "ok" : "failed",
          ...(code === 0
            ? {
                CallbackMetadata: {
                  Item: [
                    { Name: "Amount", Value: amount },
                    { Name: "MpesaReceiptNumber", Value: receipt },
                    { Name: "PhoneNumber", Value: 254712345678 },
                  ],
                },
              }
            : {}),
        },
      },
    };
  }

  /** Callback then settle, as the route does. */
  async function pay(started: { paymentId: string; checkoutRequestId: string }, opts: Parameters<typeof stkPayload>[1] = {}) {
    await recordStkCallback(deps, { payload: stkPayload(started.checkoutRequestId, opts), sourceIp: "196.201.214.200" });
    return settleStkPayment(deps, started.paymentId);
  }

  function c2bPayload(billRef: string, amount: string, transId = "C2B0000001") {
    return { TransID: transId, TransAmount: amount, BusinessShortCode: "600000", BillRefNumber: billRef, MSISDN: "254712345678" };
  }

  async function payBill(billRef: string, amount: string, transId?: string) {
    const payload = c2bPayload(billRef, amount, transId);
    const c2b = await recordC2bConfirmation(deps, { payload, sourceIp: null });
    return confirmC2b(deps, c2b!, payload);
  }

  /* ---------------------------------------------------------------------- */
  /* Starting a payment                                                     */
  /* ---------------------------------------------------------------------- */

  it("creates a pending subscription, an invoice at the plan price and a pending STK payment", async () => {
    const userId = await insertUser("pay_u_start");
    const result = await startOk(userId);

    expect(result.amountKes).toBe(2);
    expect(result.invoiceNumber).toMatch(/^VPK\d{7}$/);
    expect(daraja.pushes[0]).toMatchObject({
      phoneDaraja: "254712345678",
      amountKes: 2,
      accountReference: result.invoiceNumber,
      description: "Starter",
      callbackUrl: `https://pay.example/api/payments/stk/${"x".repeat(32)}`,
    });
    expect((await subscriptionOf("owner_user_id", userId)).status).toBe("pending");
    expect(await invoice(result.invoiceNumber)).toMatchObject({ status: "open", amount_kes: 2 });
    expect(await payment(result.paymentId)).toMatchObject({ status: "pending" });
    const events = await client.query(`select event_type, payload from payment_events where payment_id = $1`, [result.paymentId]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].event_type).toBe("stk_push");
    expect(JSON.stringify(events.rows[0].payload)).not.toContain("712345678");
  });

  it("refuses a second push within 90 seconds, then reuses the same invoice", async () => {
    const userId = await insertUser("pay_u_inflight");
    const first = await startOk(userId);
    expect(await start(userId)).toMatchObject({ ok: false, code: "in_flight" });

    clock = new Date(clock.getTime() + 100_000);
    const second = await startOk(userId);
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.paymentId).not.toBe(first.paymentId);
  });

  it("refuses verification plans, the agency plan for a user pool, and unknown plans", async () => {
    const userId = await insertUser("pay_u_rules");
    expect(await start(userId, "t_pay_verify")).toMatchObject({ ok: false, code: "plan_not_available" });
    expect(await start(userId, "t_pay_agency")).toMatchObject({ ok: false, code: "plan_not_available" });
    expect(await start(userId, "t_pay_nope")).toMatchObject({ ok: false, code: "plan_not_found" });
    expect(await start(userId, "t_pay_starter", "12345")).toMatchObject({ ok: false, code: "invalid_phone" });
    expect(daraja.pushes).toHaveLength(0);
  });

  it("lets only an agency admin pay, and only for the agency plan", async () => {
    const agencyId = await insertAgency("t-pay-agency");
    const member = await insertUser("pay_u_member", { id: agencyId, role: "member" });
    const admin = await insertUser("pay_u_admin", { id: agencyId, role: "admin" });

    expect(await start(member, "t_pay_agency")).toMatchObject({ ok: false, code: "agency_admin_only" });
    expect(await start(admin, "t_pay_starter")).toMatchObject({ ok: false, code: "plan_not_available" });
    const ok = await startOk(admin, "t_pay_agency");
    expect(ok.amountKes).toBe(9);
    expect((await subscriptionOf("owner_agency_id", agencyId)).status).toBe("pending");
  });

  it("switches an unpaid plan choice, and sends a downgrade on a paid plan to scheduling", async () => {
    const userId = await insertUser("pay_u_switch");
    const starter = await startOk(userId);
    clock = new Date(clock.getTime() + 100_000);
    const pro = await startOk(userId, "t_pay_pro");
    expect(pro.invoiceNumber).not.toBe(starter.invoiceNumber);
    expect((await invoice(starter.invoiceNumber)).status).toBe("void");

    expect(await pay(pro, { amount: 5 })).toMatchObject({ outcome: "confirmed" });
    clock = new Date(clock.getTime() + 100_000);
    expect(await start(userId, "t_pay_starter")).toMatchObject({ ok: false, code: "use_schedule" });
  });

  it("records a refused STK push and points to the Paybill", async () => {
    const userId = await insertUser("pay_u_refused");
    daraja.failNextPush = "400 400.002.02 Invalid PhoneNumber";
    const result = await start(userId);
    expect(result).toMatchObject({ ok: false, code: "daraja_rejected", paybill: deps.settings.shortcode });
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain(result.invoiceNumber!);
    const failed = await one<{ n: string }>(
      `select count(*) as n from payment_events e join invoices i on i.id = e.invoice_id
       where i.invoice_number = $1 and e.event_type = 'stk_push_failed'`,
      [result.invoiceNumber],
    );
    expect(Number(failed.n)).toBe(1);
  });

  it("rate-limits payment starts per user", async () => {
    const userId = await insertUser("pay_u_rate");
    for (let i = 0; i < 5; i++) {
      await start(userId);
    }
    expect(await start(userId)).toMatchObject({ ok: false, code: "rate_limited" });
  });

  /* ---------------------------------------------------------------------- */
  /* STK confirmation                                                       */
  /* ---------------------------------------------------------------------- */

  it("confirms a paid STK push: invoice paid for 30 days and the plan active", async () => {
    const userId = await insertUser("pay_u_confirm");
    const started = await startOk(userId);
    const outcome = await pay(started);

    expect(outcome).toMatchObject({ outcome: "confirmed" });
    expect(await payment(started.paymentId)).toMatchObject({ status: "confirmed", mpesa_receipt: "TST0000001", paid_amount_kes: 2 });
    const inv = await invoice(started.invoiceNumber);
    expect(inv.status).toBe("paid");
    expect(inv.period_end!.getTime() - inv.period_start!.getTime()).toBe(30 * DAY);
    const sub = await subscriptionOf("owner_user_id", userId);
    expect(sub.status).toBe("active");
    expect(sub.current_period_end!.getTime()).toBe(clock.getTime() + 30 * DAY);
    expect(sub.grace_ends_at!.getTime()).toBe(clock.getTime() + 33 * DAY);
  });

  it("does not extend the plan twice when the same callback is replayed", async () => {
    const userId = await insertUser("pay_u_replay");
    const started = await startOk(userId);
    await pay(started);
    const before = await subscriptionOf("owner_user_id", userId);

    clock = new Date(clock.getTime() + 60_000);
    expect(await pay(started)).toEqual({ outcome: "already_confirmed" });
    const after = await subscriptionOf("owner_user_id", userId);
    expect(after.current_period_end).toEqual(before.current_period_end);
    const confirmed = await one<{ n: string }>(
      `select count(*) as n from payments p join invoices i on i.id = p.invoice_id
       where i.invoice_number = $1 and p.status = 'confirmed'`,
      [started.invoiceNumber],
    );
    expect(Number(confirmed.n)).toBe(1);
    const callbacks = await one<{ n: string }>(
      `select count(*) as n from payment_events where payment_id = $1 and event_type = 'stk_callback'`,
      [started.paymentId],
    );
    expect(Number(callbacks.n)).toBe(2);
  });

  it("flags an amount mismatch and activates nothing", async () => {
    const userId = await insertUser("pay_u_amount");
    const started = await startOk(userId);
    expect(await pay(started, { amount: 1 })).toEqual({ outcome: "flagged", reason: "amount_mismatch" });
    expect(await payment(started.paymentId)).toMatchObject({ status: "flagged", flag_reason: "amount_mismatch", paid_amount_kes: 1 });
    expect((await subscriptionOf("owner_user_id", userId)).status).toBe("pending");
    expect((await invoice(started.invoiceNumber)).status).toBe("open");
  });

  it("closes a cancelled payment when the query agrees, and flags a disagreement", async () => {
    const userId = await insertUser("pay_u_cancel");
    const cancelled = await startOk(userId);
    daraja.queryResults.set(cancelled.checkoutRequestId, [{ kind: "result", resultCode: 1032, resultDesc: "cancelled" }]);
    expect(await pay(cancelled, { code: 1032 })).toEqual({ outcome: "closed", status: "cancelled" });

    clock = new Date(clock.getTime() + 100_000);
    const disputed = await startOk(userId);
    daraja.queryResults.set(disputed.checkoutRequestId, [{ kind: "result", resultCode: 1032, resultDesc: "cancelled" }]);
    expect(await pay(disputed)).toEqual({ outcome: "flagged", reason: "callback_query_mismatch" });
    expect((await subscriptionOf("owner_user_id", userId)).status).toBe("pending");
  });

  it("leaves the payment pending while the query is unavailable, and settles on a later run", async () => {
    const userId = await insertUser("pay_u_retry");
    const started = await startOk(userId);
    daraja.queryResults.set(started.checkoutRequestId, [
      { kind: "pending" },
      { kind: "error", error: "timeout" },
      { kind: "pending" },
    ]);
    expect(await pay(started)).toEqual({ outcome: "query_unavailable" });
    expect(daraja.queryCalls).toHaveLength(3);
    expect((await payment(started.paymentId)).status).toBe("pending");

    expect(await settleStkPayment(deps, started.paymentId)).toMatchObject({ outcome: "confirmed" });
  });

  it("ignores callbacks for unknown checkouts and unrecognised bodies, but records them", async () => {
    expect(await recordStkCallback(deps, { payload: stkPayload("ws_CO_UNKNOWN"), sourceIp: null })).toEqual({
      paymentId: null,
      valid: true,
    });
    expect(await recordStkCallback(deps, { payload: { hello: "world" }, sourceIp: null })).toEqual({
      paymentId: null,
      valid: false,
    });
    const events = await one<{ n: string }>(
      `select count(*) as n from payment_events where event_type = 'stk_callback' and payment_id is null
         and created_at = now()`,
    );
    expect(Number(events.n)).toBe(2);
  });

  /* ---------------------------------------------------------------------- */
  /* Renewal and restore                                                    */
  /* ---------------------------------------------------------------------- */

  it("stacks an early renewal onto the current period end", async () => {
    const userId = await insertUser("pay_u_early");
    const first = await startOk(userId);
    await pay(first);
    const paid = await subscriptionOf("owner_user_id", userId);

    clock = new Date(clock.getTime() + 10 * DAY);
    const renewal = await startOk(userId);
    expect(renewal.invoiceNumber).not.toBe(first.invoiceNumber);
    expect(await pay(renewal, { receipt: "TST0000002" })).toMatchObject({ outcome: "confirmed" });

    const renewed = await subscriptionOf("owner_user_id", userId);
    expect(renewed.current_period_end!.getTime()).toBe(paid.current_period_end!.getTime() + 30 * DAY);
    expect(renewed.current_period_start).toEqual(paid.current_period_start);
  });

  it("after a lapse, starts a fresh period and restores billing-paused listings up to the limit", async () => {
    const userId = await insertUser("pay_u_lapse");
    const first = await startOk(userId);
    await pay(first);
    // Lapsed 10 days ago, past grace.
    await client.query(
      `update subscriptions set current_period_start = now() - interval '40 days',
         current_period_end = now() - interval '10 days', grace_ends_at = now() - interval '7 days'
       where owner_user_id = $1`,
      [userId],
    );
    const live = await insertListing(userId, { status: "published", publishedDaysAgo: 1 });
    const newest = await insertListing(userId, { status: "paused", publishedDaysAgo: 2 });
    const middle = await insertListing(userId, { status: "paused", publishedDaysAgo: 3, pauseReason: "over_plan_limit" });
    const oldest = await insertListing(userId, { status: "paused", publishedDaysAgo: 4 });
    const otherReason = await insertListing(userId, { status: "paused", publishedDaysAgo: 0, pauseReason: "admin_hold" });

    const renewal = await startOk(userId);
    const outcome = await pay(renewal, { receipt: "TST0000003" });
    expect(outcome).toMatchObject({ outcome: "confirmed" });
    if (outcome.outcome !== "confirmed") throw new Error("unreachable");
    expect(new Set(outcome.restoredListingIds)).toEqual(new Set([newest, middle]));

    const statuses = await client.query<{ id: string; status: string; pause_reason: string | null }>(
      `select id, status, pause_reason from properties where owner_user_id = $1`,
      [userId],
    );
    const byId = new Map(statuses.rows.map((r) => [r.id, r]));
    expect(byId.get(live)!.status).toBe("published");
    expect(byId.get(newest)).toMatchObject({ status: "published", pause_reason: null });
    expect(byId.get(middle)!.status).toBe("published");
    expect(byId.get(oldest)!.status).toBe("paused");
    expect(byId.get(otherReason)!.status).toBe("paused");

    const sub = await subscriptionOf("owner_user_id", userId);
    expect(sub.current_period_start!.getTime()).toBe(clock.getTime());
    expect(sub.current_period_end!.getTime()).toBe(clock.getTime() + 30 * DAY);
  });

  /* ---------------------------------------------------------------------- */
  /* Paybill (C2B)                                                          */
  /* ---------------------------------------------------------------------- */

  it("validates Paybill payments against open invoices", async () => {
    const userId = await insertUser("pay_u_validate");
    const started = await startOk(userId);
    const validate = (ref: string, amount: string) =>
      validateC2b(deps, { payload: c2bPayload(ref, amount), sourceIp: null });

    expect(await validate(started.invoiceNumber.toLowerCase(), "2.00")).toEqual({ ResultCode: "0", ResultDesc: "Accepted" });
    expect((await validate(started.invoiceNumber, "3")).ResultCode).toBe("C2B00013");
    expect((await validate("VPK9999999", "2")).ResultCode).toBe("C2B00012");
  });

  it("activates a plan from a Paybill payment and ignores a replayed TransID", async () => {
    const userId = await insertUser("pay_u_c2b");
    const started = await startOk(userId);
    expect(await payBill(started.invoiceNumber, "2.00")).toMatchObject({ outcome: "confirmed" });
    expect((await subscriptionOf("owner_user_id", userId)).status).toBe("active");
    expect(await payBill(started.invoiceNumber, "2.00")).toEqual({ outcome: "duplicate" });
  });

  it("records unknown account numbers only, and flags Paybill amount mismatches", async () => {
    const userId = await insertUser("pay_u_c2b_bad");
    const started = await startOk(userId);
    expect(await payBill("NOT-AN-INVOICE", "2", "C2B0000002")).toEqual({ outcome: "unmatched" });
    expect(await payBill(started.invoiceNumber, "2.50", "C2B0000003")).toEqual({ outcome: "flagged", reason: "amount_mismatch" });
    expect((await subscriptionOf("owner_user_id", userId)).status).toBe("pending");
  });

  it("flags a Paybill payment for an invoice STK already paid", async () => {
    const userId = await insertUser("pay_u_double");
    const started = await startOk(userId);
    await pay(started);
    expect(await payBill(started.invoiceNumber, "2", "C2B0000004")).toEqual({ outcome: "flagged", reason: "invoice_not_open" });
  });

  it("treats a Paybill confirmation of the STK receipt as a duplicate", async () => {
    const userId = await insertUser("pay_u_same");
    const started = await startOk(userId);
    await pay(started, { receipt: "SAME000001" });
    expect(await payBill(started.invoiceNumber, "2", "SAME000001")).toEqual({ outcome: "duplicate" });
  });
});
