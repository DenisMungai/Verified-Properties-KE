import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { getListingSubscription } from "@/db/queries/billing";
import { getBillingOverview, getCardPaymentForUser, getPaymentStatusForUser, listInvoices } from "@/db/queries/billing-page";
import { receiptForUser } from "@/db/queries/receipts";
import * as schema from "@/db/schema";
import { cardSettingsFor } from "@/lib/card/config";
import type { CardDeps } from "@/lib/card/deps";
import { settleCardPayment } from "@/lib/card/settle-card";
import { paystackSignature } from "@/lib/card/signature";
import { startCardPayment } from "@/lib/card/start-card-payment";
import { handleCardWebhook } from "@/lib/card/webhook";
import type { EmailMessage } from "@/lib/email/send";
import { parseServerEnv } from "@/lib/env";
import { mpesaSettingsFor } from "@/lib/mpesa/config";
import type { PaymentDeps } from "@/lib/mpesa/deps";
import { recordStkCallback, settleStkPayment } from "@/lib/mpesa/settle";
import { startPlanPayment } from "@/lib/mpesa/start-payment";
import { createMemoryLimiter } from "@/lib/rate-limit";
import { createFakeCardGateway, type FakeCardGateway } from "@/test/fake-card-gateway";
import { createFakeDaraja } from "@/test/fake-daraja";
import { cancelScheduledChange, keepListingsAfterDowngrade, scheduleDowngrade } from "./plan-schedule";

/**
 * S6 billing against the Neon test branch: plan changes, downgrade scheduling, the keep choice,
 * receipts, status ownership and card payments, with fake Daraja and card gateways and a movable
 * clock. Each test runs in a transaction that is rolled back. Plan codes (t_ui_*) are unique to
 * this suite because suites run in parallel against the same unique indexes.
 */
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "sk_test_billingui";

describe.skipIf(!url)("Billing UI flows (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let clock: Date;
  let emails: EmailMessage[];
  let mpesa: PaymentDeps;
  let card: CardDeps;
  let gateway: FakeCardGateway;
  let receiptN = 0;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    await insertPlan({ code: "t_ui_starter", name: "Starter", price_kes: 1000, listing_limit: 3 });
    await insertPlan({ code: "t_ui_pro", name: "Pro", price_kes: 3000, listing_limit: 20 });
    await insertPlan({ code: "t_ui_agency", name: "Agency", price_kes: 9000, listing_limit: 100, is_agency_plan: true });
    clock = new Date();
    emails = [];
    const env = parseServerEnv({
      DATABASE_URL: "postgres://unused",
      MPESA_CALLBACK_TOKEN: "x".repeat(32),
      MPESA_CALLBACK_BASE_URL: "https://pay.example",
      PAYSTACK_SECRET_KEY: SECRET,
    });
    const core = {
      db,
      withTransaction: <T,>(fn: (tx: DbExecutor) => Promise<T>) => fn(db),
      now: () => clock,
      rateLimiter: createMemoryLimiter(),
      email: async (message: EmailMessage) => {
        emails.push(message);
      },
      appUrl: "https://app.example",
    };
    mpesa = { ...core, daraja: createFakeDaraja(), settings: mpesaSettingsFor(env, "test")!, sleep: async () => {} };
    gateway = createFakeCardGateway();
    card = { ...core, gateway, settings: cardSettingsFor(env, "test")! };
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
    await client.query(`insert into users (id, name, email) values ($1, $1 || ' Lister', $1 || '@ui.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, agency_id) values ($1, $1, $2)`, [id, agency?.id ?? null]);
    if (agency) {
      await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [agency.id, id, agency.role]);
    }
    return id;
  }

  async function insertAgency(slug: string): Promise<string> {
    const r = await client.query<{ id: string }>(`insert into agencies (name, slug) values ($1, $1) returning id`, [slug]);
    return r.rows[0].id;
  }

  async function insertListing(ownerId: string, status: string, publishedDaysAgo: number, pauseReason: string | null = null) {
    const r = await client.query<{ id: string }>(
      `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes,
         county, town, status, published_at, paused_at, pause_reason)
       values (gen_random_uuid()::text, $1, 'Test home', 'A test listing', 'sale', 'house', 1000000,
         'Nairobi', 'Nairobi', $2, now() - make_interval(days => $3), $4, $5)
       returning id`,
      [ownerId, status, publishedDaysAgo, status === "paused" ? new Date() : null, status === "paused" ? pauseReason : null],
    );
    return r.rows[0].id;
  }

  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
    (await client.query<T>(sql, params)).rows[0];

  type SubRow = {
    id: string;
    plan_id: string;
    status: string;
    current_period_start: Date | null;
    current_period_end: Date | null;
    scheduled_plan_id: string | null;
    scheduled_change_at: Date | null;
  };
  const subscriptionOf = (userId: string) =>
    one<SubRow>(`select * from subscriptions where owner_user_id = $1 and status in ('pending','active','past_due','paused')`, [userId]);
  const planId = async (code: string) => (await one<{ id: string }>(`select id from plans where code = $1`, [code])).id;
  const statusOf = async (id: string) => (await one<{ status: string }>(`select status from properties where id = $1`, [id])).status;

  /** Starts an M-Pesa payment and settles a successful callback for `amount`. */
  async function payMpesa(userId: string, planCode: string, amount: number) {
    const started = await startPlanPayment(mpesa, { userId, planCode, phone: "0712345678" });
    if (!started.ok) throw new Error(`start failed: ${started.code}`);
    receiptN += 1;
    const payload = {
      Body: {
        stkCallback: {
          MerchantRequestID: "m",
          CheckoutRequestID: started.checkoutRequestId,
          ResultCode: 0,
          ResultDesc: "ok",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: amount },
              { Name: "MpesaReceiptNumber", Value: `UIR${String(receiptN).padStart(7, "0")}` },
            ],
          },
        },
      },
    };
    await recordStkCallback(mpesa, { payload, sourceIp: null });
    const outcome = await settleStkPayment(mpesa, started.paymentId);
    clock = new Date(clock.getTime() + 120_000); // past the 90 s in-flight guard
    return { started, outcome };
  }

  /* ---------------------------------------------------------------------- */
  /* Upgrades, renewals and restarts                                        */
  /* ---------------------------------------------------------------------- */

  it("upgrades at once with unused days credited, and restores listings paused for the limit", async () => {
    const userId = await insertUser("ui_upgrade");
    await payMpesa(userId, "t_ui_starter", 1000);
    const paused = await insertListing(userId, "paused", 1, "over_plan_limit");
    clock = new Date((await subscriptionOf(userId)).current_period_end!.getTime() - 15 * DAY);

    const { started, outcome } = await payMpesa(userId, "t_ui_pro", 3000);
    expect(started.kind).toBe("upgrade");
    expect(outcome).toMatchObject({ outcome: "confirmed" });
    const sub = await subscriptionOf(userId);
    expect(sub.plan_id).toBe(await planId("t_ui_pro"));
    // 15 days left of KES 1,000 buy 5 days of KES 3,000: 35 days from the upgrade.
    expect(sub.current_period_end!.getTime() - sub.current_period_start!.getTime()).toBe(35 * DAY);
    expect(await statusOf(paused)).toBe("published");
  });

  it("stacks a renewal and sends one receipt email to the owner, none on a replay", async () => {
    const userId = await insertUser("ui_renew");
    const first = await payMpesa(userId, "t_ui_starter", 1000);
    const end = (await subscriptionOf(userId)).current_period_end!;
    await payMpesa(userId, "t_ui_starter", 1000);
    expect((await subscriptionOf(userId)).current_period_end!.getTime()).toBe(end.getTime() + 30 * DAY);

    expect(emails).toHaveLength(2);
    expect(emails[0].to).toBe("ui_renew@ui.test");
    expect(emails[0].subject).toContain(first.started.invoiceNumber);
    expect(emails[0].text).toContain("Paid with: M-Pesa UIR");
    expect(emails[0].text).toContain(`https://app.example/account/billing/receipts/${first.started.invoiceNumber}`);

    expect(await settleStkPayment(mpesa, first.started.paymentId)).toEqual({ outcome: "already_confirmed" });
    expect(emails).toHaveLength(2);
  });

  it("restarts a lapsed subscription on another plan from the payment, without credit", async () => {
    const userId = await insertUser("ui_restart");
    await payMpesa(userId, "t_ui_starter", 1000);
    clock = new Date(clock.getTime() + 40 * DAY);
    const { started } = await payMpesa(userId, "t_ui_pro", 3000);
    expect(started.kind).toBe("restart");
    const sub = await subscriptionOf(userId);
    expect(sub.plan_id).toBe(await planId("t_ui_pro"));
    expect(sub.current_period_end!.getTime() - sub.current_period_start!.getTime()).toBe(30 * DAY);
  });

  /* ---------------------------------------------------------------------- */
  /* Downgrades                                                             */
  /* ---------------------------------------------------------------------- */

  it("schedules a downgrade for the period end, cancels it, and renews on the lower plan", async () => {
    const userId = await insertUser("ui_down");
    await payMpesa(userId, "t_ui_pro", 3000);
    const periodEnd = (await subscriptionOf(userId)).current_period_end!;

    expect(await startPlanPayment(mpesa, { userId, planCode: "t_ui_starter", phone: "0712345678" })).toMatchObject({
      ok: false,
      code: "use_schedule",
    });
    expect(await scheduleDowngrade(mpesa, userId, "t_ui_starter")).toEqual({ ok: true, changeAt: periodEnd });
    expect(await subscriptionOf(userId)).toMatchObject({ scheduled_plan_id: await planId("t_ui_starter"), scheduled_change_at: periodEnd });

    expect(await cancelScheduledChange(mpesa, userId)).toMatchObject({ ok: true });
    expect((await subscriptionOf(userId)).scheduled_plan_id).toBeNull();
    expect(await cancelScheduledChange(mpesa, userId)).toMatchObject({ ok: false, code: "nothing_scheduled" });

    await scheduleDowngrade(mpesa, userId, "t_ui_starter");
    const { started } = await payMpesa(userId, "t_ui_starter", 1000);
    expect(started.kind).toBe("renew");
    expect(started.amountKes).toBe(1000);
    const sub = await subscriptionOf(userId);
    // Renewed early: Pro until the change date, Starter from then on.
    expect(sub.plan_id).toBe(await planId("t_ui_pro"));
    expect(sub.scheduled_change_at).toEqual(periodEnd);
    expect(sub.current_period_end!.getTime()).toBe(periodEnd.getTime() + 30 * DAY);

    const pool = { kind: "user" as const, userId };
    expect((await getListingSubscription(db, pool, clock))?.listingLimit).toBe(20);
    expect((await getListingSubscription(db, pool, new Date(periodEnd.getTime() + 1)))?.listingLimit).toBe(3);
  });

  it("after the change date, lets the lister choose which listings stay live", async () => {
    const userId = await insertUser("ui_keep");
    await payMpesa(userId, "t_ui_pro", 3000);
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await insertListing(userId, "published", i + 1));
    const inReview = await insertListing(userId, "pending_review", 0);
    await scheduleDowngrade(mpesa, userId, "t_ui_starter");

    expect(await keepListingsAfterDowngrade(mpesa, userId, [ids[0]])).toMatchObject({ ok: false, code: "not_over_limit" });
    clock = new Date((await subscriptionOf(userId)).scheduled_change_at!.getTime() + DAY);

    const overview = await getBillingOverview(db, userId, clock);
    expect(overview.effectivePlan?.code).toBe("t_ui_starter");
    expect(overview.activeListingCount).toBe(5);

    const stranger = await insertUser("ui_keep_other");
    const foreign = await insertListing(stranger, "published", 1);
    expect(await keepListingsAfterDowngrade(mpesa, userId, [ids[0], foreign])).toMatchObject({ ok: false, code: "invalid_choice" });
    expect(await keepListingsAfterDowngrade(mpesa, userId, ids)).toMatchObject({ ok: false, code: "invalid_choice" });

    expect(await keepListingsAfterDowngrade(mpesa, userId, [ids[1], ids[3], inReview])).toMatchObject({ ok: true });
    expect(await statusOf(ids[1])).toBe("published");
    expect(await statusOf(ids[3])).toBe("published");
    expect(await statusOf(inReview)).toBe("pending_review");
    expect(await statusOf(ids[0])).toBe("paused");
    expect(await statusOf(ids[2])).toBe("paused");
    expect(
      await one<{ pause_reason: string }>(`select pause_reason from properties where id = $1`, [ids[0]]),
    ).toEqual({ pause_reason: "over_plan_limit" });
  });

  it("sends listings in review back to draft rather than pausing them", async () => {
    const userId = await insertUser("ui_keep_review");
    await payMpesa(userId, "t_ui_pro", 3000);
    const live = [];
    for (let i = 0; i < 3; i++) live.push(await insertListing(userId, "published", i + 1));
    const inReview = await insertListing(userId, "pending_review", 0);
    await scheduleDowngrade(mpesa, userId, "t_ui_starter");
    clock = new Date((await subscriptionOf(userId)).scheduled_change_at!.getTime() + DAY);

    expect(await keepListingsAfterDowngrade(mpesa, userId, live)).toMatchObject({ ok: true });
    expect(await statusOf(inReview)).toBe("draft");
  });

  /* ---------------------------------------------------------------------- */
  /* Agency and ownership                                                   */
  /* ---------------------------------------------------------------------- */

  it("emails agency admins only, and keeps payments and receipts within the pool", async () => {
    const agencyId = await insertAgency("t-ui-agency");
    const admin = await insertUser("ui_ag_admin", { id: agencyId, role: "admin" });
    const member = await insertUser("ui_ag_member", { id: agencyId, role: "member" });
    const stranger = await insertUser("ui_stranger");
    const { started } = await payMpesa(admin, "t_ui_agency", 9000);

    expect(emails.map((e) => e.to)).toEqual(["ui_ag_admin@ui.test"]);
    expect(await getPaymentStatusForUser(db, member, started.paymentId)).toMatchObject({ status: "confirmed" });
    expect(await getPaymentStatusForUser(db, stranger, started.paymentId)).toBeNull();
    expect(await receiptForUser(db, member, started.invoiceNumber)).toMatchObject({ accountName: "t-ui-agency" });
    expect(await receiptForUser(db, stranger, started.invoiceNumber)).toBeNull();

    const overview = await getBillingOverview(db, member, clock);
    expect(overview.canManage).toBe(false);
    expect(await scheduleDowngrade(mpesa, member, "t_ui_agency")).toMatchObject({ ok: false, code: "agency_admin_only" });
    expect(await listInvoices(db, overview.pool)).toHaveLength(1);
  });

  /* ---------------------------------------------------------------------- */
  /* Card payments                                                          */
  /* ---------------------------------------------------------------------- */

  async function startCard(userId: string, planCode = "t_ui_starter") {
    const started = await startCardPayment(card, { userId, email: `${userId}@ui.test`, planCode });
    if (!started.ok) throw new Error(`card start failed: ${started.code}`);
    return started;
  }

  it("confirms a card payment only after Verify agrees, once", async () => {
    const userId = await insertUser("ui_card");
    const started = await startCard(userId);
    expect(gateway.inits[0]).toMatchObject({ amountKes: 1000, callbackUrl: "https://app.example/account/billing/checkout/card-return" });
    const reference = gateway.inits[0].reference;
    expect(await getCardPaymentForUser(db, userId, reference)).toMatchObject({ id: started.paymentId, status: "pending" });

    expect(await settleCardPayment(card, started.paymentId, "return")).toMatchObject({ outcome: "confirmed" });
    expect(await one(`select status, card_brand, card_last4, mpesa_receipt from payments where id = $1`, [started.paymentId])).toEqual({
      status: "confirmed",
      card_brand: "visa",
      card_last4: "4081",
      mpesa_receipt: null,
    });
    expect((await subscriptionOf(userId)).status).toBe("active");
    expect(emails).toHaveLength(1);
    expect(emails[0].text).toContain("Paid with: Visa •••• 4081");

    expect(await settleCardPayment(card, started.paymentId, "webhook")).toEqual({ outcome: "already_confirmed" });
    expect(emails).toHaveLength(1);
  });

  it("keeps a declined card payment open so a later success still confirms", async () => {
    const userId = await insertUser("ui_card_decline");
    const started = await startCard(userId);
    const reference = gateway.inits[0].reference;
    gateway.verifyResults.set(reference, { status: "failed" });
    expect(await settleCardPayment(card, started.paymentId, "return")).toEqual({ outcome: "declined", gatewayStatus: "failed" });
    expect(await getPaymentStatusForUser(db, userId, started.paymentId)).toMatchObject({ status: "pending", resultDesc: "failed" });

    gateway.verifyResults.delete(reference);
    expect(await settleCardPayment(card, started.paymentId, "webhook")).toMatchObject({ outcome: "confirmed" });
  });

  it("flags a card payment whose verified amount or currency differs from the invoice", async () => {
    const userId = await insertUser("ui_card_amount");
    const started = await startCard(userId);
    gateway.verifyResults.set(gateway.inits[0].reference, { amountMinor: 50_000 });
    expect(await settleCardPayment(card, started.paymentId, "return")).toEqual({ outcome: "flagged", reason: "amount_mismatch" });

    const other = await insertUser("ui_card_currency");
    const second = await startCard(other);
    gateway.verifyResults.set(gateway.inits[1].reference, { currency: "USD" });
    expect(await settleCardPayment(card, second.paymentId, "return")).toEqual({ outcome: "flagged", reason: "amount_mismatch" });
    expect(emails).toHaveLength(0);
  });

  it("refuses an unsigned webhook without recording it, and settles a signed charge.success", async () => {
    const userId = await insertUser("ui_card_hook");
    const started = await startCard(userId);
    const body = JSON.stringify({ event: "charge.success", data: { reference: gateway.inits[0].reference } });
    const request = (signature: string) =>
      new Request("https://app.example/api/payments/card/webhook", {
        method: "POST",
        headers: { "x-paystack-signature": signature, "content-type": "application/json" },
        body,
      });
    const events = async () =>
      Number((await one<{ n: string }>(`select count(*) as n from payment_events where payment_id = $1 and event_type = 'card_webhook'`, [started.paymentId])).n);

    expect(await handleCardWebhook(card, request("0".repeat(128)))).toEqual({ status: 401 });
    expect(await events()).toBe(0);

    expect(await handleCardWebhook(card, request(paystackSignature(body, SECRET)))).toEqual({
      status: 200,
      settlePaymentId: started.paymentId,
    });
    expect(await events()).toBe(1);
  });

  it("uses the same invoice for card and M-Pesa, and flags the second payment of a paid invoice", async () => {
    const userId = await insertUser("ui_card_both");
    const cardStart = await startCard(userId);
    const mpesaPaid = await payMpesa(userId, "t_ui_starter", 1000);
    expect(mpesaPaid.started.invoiceNumber).toBe(cardStart.invoiceNumber);
    expect(await settleCardPayment(card, cardStart.paymentId, "webhook")).toEqual({ outcome: "flagged", reason: "invoice_not_open" });
  });
});
