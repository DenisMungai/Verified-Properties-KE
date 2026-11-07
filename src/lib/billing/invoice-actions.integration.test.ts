import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { getBillingOverview, listInvoices } from "@/db/queries/billing-page";
import * as schema from "@/db/schema";
import { cardSettingsFor } from "@/lib/card/config";
import type { CardDeps } from "@/lib/card/deps";
import { startCardPayment } from "@/lib/card/start-card-payment";
import type { EmailMessage } from "@/lib/email/send";
import { parseServerEnv } from "@/lib/env";
import { mpesaSettingsFor } from "@/lib/mpesa/config";
import type { PaymentDeps } from "@/lib/mpesa/deps";
import { recordStkCallback, settleStkPayment } from "@/lib/mpesa/settle";
import { startPlanPayment } from "@/lib/mpesa/start-payment";
import { createMemoryLimiter } from "@/lib/rate-limit";
import { createFakeCardGateway } from "@/test/fake-card-gateway";
import { createFakeDaraja } from "@/test/fake-daraja";
import { CARD_CANCEL_BLOCK_MINUTES, IN_FLIGHT_SECONDS } from "./constants";
import { cancelInvoice, hideInvoice } from "./invoice-actions";

/**
 * Listers cancelling and removing unpaid invoices (prompt billing-cancel-delete-invoices) against
 * the Neon test branch, with fake Daraja and card gateways and a movable clock. Each test runs in
 * a rolled-back transaction. Plan codes (t_inv_*) are unique to this suite.
 */
const url = process.env.TEST_DATABASE_URL;
const PAST_STK_GUARD = (IN_FLIGHT_SECONDS + 30) * 1000;

describe.skipIf(!url)("Invoice cancel and delete (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let clock: Date;
  let mpesa: PaymentDeps;
  let card: CardDeps;
  let receiptN = 0;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    await insertPlan({ code: "t_inv_starter", name: "Starter", price_kes: 1000, listing_limit: 3 });
    await insertPlan({ code: "t_inv_pro", name: "Pro", price_kes: 3000, listing_limit: 20 });
    await insertPlan({ code: "t_inv_agency", name: "Agency", price_kes: 9000, listing_limit: 100, is_agency_plan: true });
    clock = new Date();
    const env = parseServerEnv({
      DATABASE_URL: "postgres://unused",
      MPESA_CALLBACK_TOKEN: "x".repeat(32),
      MPESA_CALLBACK_BASE_URL: "https://pay.example",
      PAYSTACK_SECRET_KEY: "sk_test_invoiceactions",
    });
    const core = {
      db,
      withTransaction: <T,>(fn: (tx: DbExecutor) => Promise<T>) => fn(db),
      now: () => clock,
      rateLimiter: createMemoryLimiter(),
      email: async (message: EmailMessage) => void message,
      appUrl: "https://app.example",
    };
    mpesa = { ...core, daraja: createFakeDaraja(), settings: mpesaSettingsFor(env, "test")!, sleep: async () => {} };
    card = { ...core, gateway: createFakeCardGateway(), settings: cardSettingsFor(env, "test")! };
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
    await client.query(`insert into users (id, name, email) values ($1, $1 || ' Lister', $1 || '@inv.test')`, [id]);
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

  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
    (await client.query<T>(sql, params)).rows[0];

  const invoiceRow = (number: string) =>
    one<{ status: string; voided_at: Date | null; lister_hidden_at: Date | null; subscription_id: string }>(
      `select status, voided_at, lister_hidden_at, subscription_id from invoices where invoice_number = $1`,
      [number],
    );
  const subscriptionRow = (id: string) =>
    one<{ status: string; cancelled_at: Date | null; current_period_end: Date | null }>(
      `select status, cancelled_at, current_period_end from subscriptions where id = $1`,
      [id],
    );
  const cancelEvents = async (number: string) =>
    Number(
      (
        await one<{ n: string }>(
          `select count(*) as n from payment_events e join invoices i on i.id = e.invoice_id
           where i.invoice_number = $1 and e.event_type = 'invoice_cancelled'`,
          [number],
        )
      ).n,
    );

  async function startMpesa(userId: string, planCode = "t_inv_starter") {
    const started = await startPlanPayment(mpesa, { userId, planCode, phone: "0712345678" });
    if (!started.ok) throw new Error(`start failed: ${started.code}`);
    return started;
  }

  /** Records and settles a successful STK callback for a started payment. */
  async function succeed(started: { checkoutRequestId: string; paymentId: string }, amount: number) {
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
              { Name: "MpesaReceiptNumber", Value: `INV${String(receiptN).padStart(7, "0")}` },
            ],
          },
        },
      },
    };
    await recordStkCallback(mpesa, { payload, sourceIp: null });
    return settleStkPayment(mpesa, started.paymentId);
  }

  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  /* ---------------------------------------------------------------------- */
  /* Cancelling                                                             */
  /* ---------------------------------------------------------------------- */

  it("waits out an STK push, then cancels a never-paid plan's invoice and closes the plan", async () => {
    const userId = await insertUser("inv_new");
    const started = await startMpesa(userId);
    const { subscription_id: subId } = await invoiceRow(started.invoiceNumber);

    expect(await cancelInvoice(mpesa, userId, started.invoiceNumber)).toEqual({ ok: false, code: "in_progress" });
    expect((await invoiceRow(started.invoiceNumber)).status).toBe("open");

    advance(PAST_STK_GUARD);
    expect(await cancelInvoice(mpesa, userId, started.invoiceNumber)).toEqual({ ok: true, subscriptionCancelled: true });
    expect(await invoiceRow(started.invoiceNumber)).toMatchObject({ status: "void", voided_at: clock });
    expect(await subscriptionRow(subId)).toMatchObject({ status: "cancelled", cancelled_at: clock });

    // Idempotent: a second submit changes nothing and records nothing.
    expect(await cancelInvoice(mpesa, userId, started.invoiceNumber)).toEqual({ ok: true, subscriptionCancelled: false });
    expect(await cancelEvents(started.invoiceNumber)).toBe(1);

    const overview = await getBillingOverview(db, userId, clock);
    expect(overview.subscription).toBeNull();
    expect(overview.openInvoice).toBeNull();

    // Choosing a plan again starts afresh.
    const again = await startMpesa(userId);
    expect(again.invoiceNumber).not.toBe(started.invoiceNumber);
    expect((await invoiceRow(again.invoiceNumber)).subscription_id).not.toBe(subId);
  });

  it("flags a late payment on a cancelled invoice and never activates it", async () => {
    const userId = await insertUser("inv_late");
    const started = await startMpesa(userId);
    const { subscription_id: subId } = await invoiceRow(started.invoiceNumber);
    advance(PAST_STK_GUARD);
    expect((await cancelInvoice(mpesa, userId, started.invoiceNumber)).ok).toBe(true);

    await succeed(started, 1000);
    const payment = await one<{ status: string; flag_reason: string | null }>(
      `select status, flag_reason from payments where id = $1`,
      [started.paymentId],
    );
    expect(payment).toMatchObject({ status: "flagged", flag_reason: "invoice_not_open" });
    expect((await invoiceRow(started.invoiceNumber)).status).toBe("void");
    expect((await subscriptionRow(subId)).status).toBe("cancelled");

    // Money touched it, so it stays on the lister's list.
    expect(await hideInvoice(mpesa, userId, started.invoiceNumber)).toEqual({ ok: false, code: "not_deletable" });
    const overview = await getBillingOverview(db, userId, clock);
    const rows = await listInvoices(db, overview.pool);
    expect(rows.find((r) => r.invoiceNumber === started.invoiceNumber)).toMatchObject({ status: "void", hasMoney: true });
  });

  it("cancels a renewal invoice without touching an active plan", async () => {
    const userId = await insertUser("inv_renew");
    const first = await startMpesa(userId);
    await succeed(first, 1000);
    advance(PAST_STK_GUARD);
    const { subscription_id: subId } = await invoiceRow(first.invoiceNumber);
    const before = await subscriptionRow(subId);
    expect(before.status).toBe("active");

    const renewal = await startMpesa(userId);
    advance(PAST_STK_GUARD);
    expect(await cancelInvoice(mpesa, userId, renewal.invoiceNumber)).toEqual({ ok: true, subscriptionCancelled: false });
    expect(await subscriptionRow(subId)).toEqual(before);

    // The paid invoice can be neither cancelled nor removed.
    expect(await cancelInvoice(mpesa, userId, first.invoiceNumber)).toEqual({ ok: false, code: "not_cancellable" });
    expect(await hideInvoice(mpesa, userId, first.invoiceNumber)).toEqual({ ok: false, code: "not_deletable" });
  });

  it("blocks cancelling during a recent card checkout", async () => {
    const userId = await insertUser("inv_card");
    const started = await startCardPayment(card, { userId, email: "inv_card@inv.test", planCode: "t_inv_starter" });
    if (!started.ok) throw new Error(`card start failed: ${started.code}`);
    const { invoice_number: number } = await one<{ invoice_number: string }>(
      `select i.invoice_number from invoices i join subscriptions s on s.id = i.subscription_id
       where s.owner_user_id = $1 and i.status = 'open'`,
      [userId],
    );

    advance(PAST_STK_GUARD);
    expect(await cancelInvoice(card, userId, number)).toEqual({ ok: false, code: "in_progress" });
    advance(CARD_CANCEL_BLOCK_MINUTES * 60 * 1000);
    expect((await cancelInvoice(card, userId, number)).ok).toBe(true);
  });

  /* ---------------------------------------------------------------------- */
  /* Removing                                                               */
  /* ---------------------------------------------------------------------- */

  it("removes a void, never-paid invoice from the lister's list only", async () => {
    const userId = await insertUser("inv_hide");
    const started = await startMpesa(userId);
    expect(await hideInvoice(mpesa, userId, started.invoiceNumber)).toEqual({ ok: false, code: "not_deletable" });

    advance(PAST_STK_GUARD);
    await cancelInvoice(mpesa, userId, started.invoiceNumber);
    expect(await hideInvoice(mpesa, userId, started.invoiceNumber)).toEqual({ ok: true });
    expect(await hideInvoice(mpesa, userId, started.invoiceNumber)).toEqual({ ok: true });
    expect((await invoiceRow(started.invoiceNumber)).lister_hidden_at).toEqual(clock);

    const overview = await getBillingOverview(db, userId, clock);
    expect(await listInvoices(db, overview.pool)).toEqual([]);
  });

  it("keeps the database from hiding an invoice that isn't void", async () => {
    const userId = await insertUser("inv_check");
    const started = await startMpesa(userId);
    await expect(
      client.query(`update invoices set lister_hidden_at = now() where invoice_number = $1`, [started.invoiceNumber]),
    ).rejects.toThrow(/invoices_hidden_only_void/);
  });

  /* ---------------------------------------------------------------------- */
  /* Who may act                                                            */
  /* ---------------------------------------------------------------------- */

  it("lets only the plan's manager act, and hides other owners' invoices", async () => {
    const agencyId = await insertAgency("t-inv-agency");
    const admin = await insertUser("inv_ag_admin", { id: agencyId, role: "admin" });
    const member = await insertUser("inv_ag_member", { id: agencyId, role: "member" });
    const stranger = await insertUser("inv_stranger");
    const started = await startMpesa(admin, "t_inv_agency");
    advance(PAST_STK_GUARD);

    expect(await cancelInvoice(mpesa, member, started.invoiceNumber)).toEqual({ ok: false, code: "forbidden" });
    expect(await cancelInvoice(mpesa, stranger, started.invoiceNumber)).toEqual({ ok: false, code: "not_found" });
    expect(await hideInvoice(mpesa, stranger, started.invoiceNumber)).toEqual({ ok: false, code: "not_found" });
    expect((await invoiceRow(started.invoiceNumber)).status).toBe("open");

    expect(await cancelInvoice(mpesa, admin, started.invoiceNumber)).toEqual({ ok: true, subscriptionCancelled: true });
  });
});
