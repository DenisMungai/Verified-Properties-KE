import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { getPaybillEvent, unresolvedPaybillEvents } from "@/db/queries/billing-admin";
import { unmatchedPaybill } from "@/db/queries/reconciliation";
import * as schema from "@/db/schema";
import type { EmailMessage } from "@/lib/email/send";
import {
  activateFlaggedPayment,
  applyPaybillToInvoice,
  closeFlaggedPayment,
  convertFlaggedPaymentToCredit,
  grantGoodwillCredit,
  recordPaybillPayment,
  refundFlaggedPayment,
  refundPaybillEvent,
  type AdminDeps,
} from "./admin-actions";

/**
 * S10 admin billing actions against the Neon test branch (TEST_DATABASE_URL). Each test runs in a
 * transaction that is rolled back; each action runs in a savepoint so a refusal rolls back only
 * its own writes, as a real transaction would. Plan codes (t_adm_*) differ from other suites.
 */
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;
const REASON = "Checked against the M-Pesa statement today.";

describe.skipIf(!url)("billing admin actions (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let clock: Date;
  let emails: EmailMessage[];
  let deps: AdminDeps;
  let admin: string;
  let starterId: string;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    clock = new Date();
    emails = [];
    let savepoint = 0;
    deps = {
      db,
      withTransaction: async (fn) => {
        const name = `adm_${++savepoint}`;
        await client.query(`SAVEPOINT ${name}`);
        try {
          const result = await fn(db);
          await client.query(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          throw error;
        }
      },
      now: () => clock,
      email: async (message) => {
        emails.push(message);
      },
      appUrl: "https://app.example",
    };
    starterId = await insertPlan("t_adm_starter", 2, 3);
    admin = await insertUser("adm_admin");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  /* ---------------------------------------------------------------------- */
  /* Fixtures                                                               */
  /* ---------------------------------------------------------------------- */

  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
    (await client.query<T>(sql, params)).rows[0];

  async function insertPlan(code: string, price: number, limit: number): Promise<string> {
    return (
      await one<{ id: string }>(`insert into plans (code, kind, name, price_kes, listing_limit) values ($1, 'listing', $1, $2, $3) returning id`, [
        code,
        price,
        limit,
      ])
    ).id;
  }

  async function insertUser(id: string): Promise<string> {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@adm.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name) values ($1, $1)`, [id]);
    return id;
  }

  /** A subscription: `pending` (never paid), `active` (paid until +10 days) or `lapsed`. */
  async function insertSubscription(userId: string, state: "pending" | "active" | "lapsed"): Promise<string> {
    const end = state === "active" ? new Date(clock.getTime() + 10 * DAY) : new Date(clock.getTime() - 10 * DAY);
    const row =
      state === "pending"
        ? await one<{ id: string }>(`insert into subscriptions (owner_user_id, kind, plan_id) values ($1, 'listing', $2) returning id`, [userId, starterId])
        : await one<{ id: string }>(
            `insert into subscriptions (owner_user_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at)
             values ($1, 'listing', $2, $3, $4, $5, $6) returning id`,
            [userId, starterId, state === "active" ? "active" : "paused", new Date(end.getTime() - 30 * DAY), end, new Date(end.getTime() + 3 * DAY)],
          );
    return row.id;
  }

  async function insertInvoice(subscriptionId: string, status: "open" | "paid" = "open"): Promise<{ id: string; number: string }> {
    const paid = status === "paid";
    const row = await one<{ id: string; invoice_number: string }>(
      `insert into invoices (subscription_id, plan_id, amount_kes, status, paid_at, period_start, period_end)
       values ($1, $2, 2, $3, $4, $5, $6) returning id, invoice_number`,
      [subscriptionId, starterId, status, paid ? clock : null, paid ? clock : null, paid ? new Date(clock.getTime() + 30 * DAY) : null],
    );
    return { id: row.id, number: row.invoice_number };
  }

  let checkout = 0;
  async function insertFlagged(
    invoiceId: string,
    flag: string,
    opts: { receipt?: string | null; paid?: number | null; method?: "stk_push" | "card" } = {},
  ): Promise<string> {
    const method = opts.method ?? "stk_push";
    return (
      await one<{ id: string }>(
        `insert into payments (invoice_id, method, phone_e164, checkout_request_id, provider_reference, mpesa_receipt, amount_kes, paid_amount_kes, status, flag_reason)
         values ($1, $2, '+254712345678', $3, $4, $5, 2, $6, 'flagged', $7) returning id`,
        [
          invoiceId,
          method,
          method === "stk_push" ? `adm_checkout_${++checkout}` : null,
          method === "card" ? `adm_card_${++checkout}` : null,
          opts.receipt ?? null,
          opts.paid ?? null,
          flag,
        ],
      )
    ).id;
  }

  async function insertPausedListing(userId: string): Promise<string> {
    return (
      await one<{ id: string }>(
        `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town, status, published_at, paused_at, pause_reason)
         values (gen_random_uuid()::text, $1, 'Test home', 'A test listing', 'sale', 'house', 1000000, 'Nairobi', 'Nairobi', 'paused', now() - interval '3 days', now(), 'plan_lapsed')
         returning id`,
        [userId],
      )
    ).id;
  }

  async function insertPaybillEvent(transId: string, amount: string, billRef = "WRONGREF"): Promise<string> {
    return (
      await one<{ id: string }>(`insert into payment_events (event_type, payload) values ('c2b_confirmation', $1) returning id`, [
        JSON.stringify({ TransID: transId, TransAmount: amount, BusinessShortCode: "600000", BillRefNumber: billRef, MSISDN: "254712345678" }),
      ])
    ).id;
  }

  const payment = (id: string) =>
    one<{ status: string; mpesa_receipt: string | null; paid_amount_kes: number | null; flag_reason: string | null }>(`select * from payments where id = $1`, [id]);
  const subscription = (id: string) =>
    one<{ status: string; current_period_end: Date | null; grace_ends_at: Date | null }>(`select * from subscriptions where id = $1`, [id]);
  const audits = (paymentId: string | null = null) =>
    client
      .query<{ action: string; amount_kes: number | null; credit_days: number | null; reference: string | null; actor_user_id: string }>(
        paymentId ? `select * from billing_audit_log where payment_id = $1` : `select * from billing_audit_log where actor_user_id = $1`,
        [paymentId ?? admin],
      )
      .then((r) => r.rows);

  /* ---------------------------------------------------------------------- */
  /* Activate                                                               */
  /* ---------------------------------------------------------------------- */

  it("activates a missing-receipt payment with statement values, confirms it and restores listings", async () => {
    const lister = await insertUser("adm_l1");
    const sub = await insertSubscription(lister, "lapsed");
    const invoice = await insertInvoice(sub);
    const listing = await insertPausedListing(lister);
    const id = await insertFlagged(invoice.id, "missing_receipt");

    const result = await activateFlaggedPayment(deps, admin, { paymentId: id, receipt: "ADMA000001", amountKes: 2, reason: REASON });

    expect(result).toMatchObject({ ok: true, paymentId: id, restoredListings: 1 });
    expect(await payment(id)).toMatchObject({ status: "confirmed", mpesa_receipt: "ADMA000001", paid_amount_kes: 2 });
    expect((await one<{ status: string }>(`select status from invoices where id = $1`, [invoice.id])).status).toBe("paid");
    const after = await subscription(sub);
    expect(after.status).toBe("active");
    expect(after.current_period_end!.getTime()).toBe(clock.getTime() + 30 * DAY);
    expect((await one<{ status: string }>(`select status from properties where id = $1`, [listing])).status).toBe("published");
    expect(await audits(id)).toEqual([expect.objectContaining({ action: "activate_payment", amount_kes: 2, reference: "ADMA000001", actor_user_id: admin })]);
    expect(emails.length).toBeGreaterThan(0);
  });

  it("refuses a wrong amount and changes nothing", async () => {
    const sub = await insertSubscription(await insertUser("adm_l2"), "pending");
    const invoice = await insertInvoice(sub);
    const id = await insertFlagged(invoice.id, "missing_receipt");

    expect(await activateFlaggedPayment(deps, admin, { paymentId: id, receipt: "ADMA000002", amountKes: 5, reason: REASON })).toEqual({
      ok: false,
      code: "amount_mismatch",
    });
    expect(await payment(id)).toMatchObject({ status: "flagged", mpesa_receipt: null });
    expect(await audits(id)).toEqual([]);
    expect(emails).toEqual([]);
  });

  it("refuses a receipt that another payment already holds", async () => {
    const sub = await insertSubscription(await insertUser("adm_l3"), "pending");
    const invoice = await insertInvoice(sub);
    const holder = await insertFlagged(invoice.id, "duplicate_receipt", { receipt: "ADMA000003", paid: 2 });
    const id = await insertFlagged(invoice.id, "missing_receipt");

    expect(await activateFlaggedPayment(deps, admin, { paymentId: id, receipt: "ADMA000003", amountKes: 2, reason: REASON })).toEqual({
      ok: false,
      code: "receipt_in_use",
      otherPaymentId: holder,
    });
  });

  it("uses the stored callback and refuses typed values that disagree with it", async () => {
    const sub = await insertSubscription(await insertUser("adm_l4"), "pending");
    const invoice = await insertInvoice(sub);
    const id = await insertFlagged(invoice.id, "callback_query_mismatch", { receipt: "ADMA000004", paid: 2 });

    expect((await activateFlaggedPayment(deps, admin, { paymentId: id, receipt: "ADMA999999", amountKes: null, reason: REASON })).ok).toBe(false);
    const result = await activateFlaggedPayment(deps, admin, { paymentId: id, receipt: null, amountKes: null, reason: REASON });
    expect(result.ok).toBe(true);
    expect(await activateFlaggedPayment(deps, admin, { paymentId: id, receipt: null, amountKes: null, reason: REASON })).toEqual({
      ok: false,
      code: "already_resolved",
    });
    expect(await audits(id)).toHaveLength(1);
  });

  it("doesn't activate flags that mean the money bought nothing, or card payments", async () => {
    const sub = await insertSubscription(await insertUser("adm_l5"), "pending");
    const invoice = await insertInvoice(sub);
    const mismatch = await insertFlagged(invoice.id, "amount_mismatch", { receipt: "ADMA000005", paid: 5 });
    const card = await insertFlagged(invoice.id, "callback_query_mismatch", { method: "card", paid: 2 });
    expect(await activateFlaggedPayment(deps, admin, { paymentId: mismatch, receipt: null, amountKes: null, reason: REASON })).toMatchObject({ code: "not_allowed" });
    expect(await activateFlaggedPayment(deps, admin, { paymentId: card, receipt: "ADMA000006", amountKes: 2, reason: REASON })).toMatchObject({ code: "not_allowed" });
  });

  /* ---------------------------------------------------------------------- */
  /* Credit, refund, close                                                  */
  /* ---------------------------------------------------------------------- */

  it("turns a payment on a paid invoice into plan days", async () => {
    const sub = await insertSubscription(await insertUser("adm_l6"), "active");
    const invoice = await insertInvoice(sub, "paid");
    const id = await insertFlagged(invoice.id, "invoice_not_open", { receipt: "ADMA000007", paid: 2 });
    const before = await subscription(sub);

    expect(await convertFlaggedPaymentToCredit(deps, admin, { paymentId: id, reason: REASON })).toMatchObject({ ok: true, creditDays: 30 });
    const after = await subscription(sub);
    expect(after.current_period_end!.getTime()).toBe(before.current_period_end!.getTime() + 30 * DAY);
    expect(after.grace_ends_at!.getTime()).toBe(after.current_period_end!.getTime() + 3 * DAY);
    expect((await payment(id)).status).toBe("credited");
    expect(await audits(id)).toEqual([expect.objectContaining({ action: "credit_from_payment", amount_kes: 2, credit_days: 30 })]);
  });

  it("refuses to credit a lapsed plan", async () => {
    const sub = await insertSubscription(await insertUser("adm_l7"), "lapsed");
    const invoice = await insertInvoice(sub, "paid");
    const id = await insertFlagged(invoice.id, "invoice_not_open", { receipt: "ADMA000008", paid: 2 });
    expect(await convertFlaggedPaymentToCredit(deps, admin, { paymentId: id, reason: REASON })).toEqual({ ok: false, code: "plan_lapsed" });
    expect((await payment(id)).status).toBe("flagged");
  });

  it("records refunds up to the paid amount, and closes flagged payments", async () => {
    const sub = await insertSubscription(await insertUser("adm_l8"), "pending");
    const invoice = await insertInvoice(sub);
    const refund = await insertFlagged(invoice.id, "amount_mismatch", { receipt: "ADMA000009", paid: 5 });
    const close = await insertFlagged(invoice.id, "duplicate_receipt");

    expect(await refundFlaggedPayment(deps, admin, { paymentId: refund, reference: "REV123", amountKes: 6, reason: REASON })).toEqual({
      ok: false,
      code: "refund_too_large",
    });
    expect((await refundFlaggedPayment(deps, admin, { paymentId: refund, reference: "REV123", amountKes: 5, reason: REASON })).ok).toBe(true);
    expect((await payment(refund)).status).toBe("refunded");
    expect(await audits(refund)).toEqual([expect.objectContaining({ action: "refund_payment", amount_kes: 5, reference: "REV123" })]);

    expect((await closeFlaggedPayment(deps, admin, { paymentId: close, reason: REASON })).ok).toBe(true);
    expect((await payment(close)).status).toBe("failed");
    expect((await one<{ status: string }>(`select status from invoices where id = $1`, [invoice.id])).status).toBe("open");
  });

  it("adds goodwill days to a paid plan only", async () => {
    const active = await insertSubscription(await insertUser("adm_l9"), "active");
    const lapsed = await insertSubscription(await insertUser("adm_l10"), "lapsed");
    const before = await subscription(active);

    expect(await grantGoodwillCredit(deps, admin, { subscriptionId: active, days: 5, reason: REASON })).toMatchObject({ ok: true, creditDays: 5 });
    expect((await subscription(active)).current_period_end!.getTime()).toBe(before.current_period_end!.getTime() + 5 * DAY);
    expect(await grantGoodwillCredit(deps, admin, { subscriptionId: lapsed, days: 5, reason: REASON })).toEqual({ ok: false, code: "plan_lapsed" });
    expect((await audits()).filter((a) => a.action === "credit_days")).toHaveLength(1);
  });

  /* ---------------------------------------------------------------------- */
  /* Paybill money                                                          */
  /* ---------------------------------------------------------------------- */

  it("applies unmatched Paybill money to an open invoice once, and resolves it everywhere", async () => {
    const sub = await insertSubscription(await insertUser("adm_l11"), "pending");
    const invoice = await insertInvoice(sub);
    const eventId = await insertPaybillEvent("ADMP000001", "2");
    const since = new Date(clock.getTime() - DAY);

    expect((await unresolvedPaybillEvents(db)).map((e) => e.id)).toContain(eventId);
    expect((await unmatchedPaybill(db, since)).ids).toContain(eventId);

    expect(await applyPaybillToInvoice(deps, admin, { eventId, invoiceNumber: "VPK9999999", reason: REASON })).toEqual({ ok: false, code: "invoice_not_found" });
    const result = await applyPaybillToInvoice(deps, admin, { eventId, invoiceNumber: invoice.number, reason: REASON });
    expect(result).toMatchObject({ ok: true });
    const paymentId = result.ok ? result.paymentId! : "";
    expect(await one(`select method, status, mpesa_receipt, phone_e164 from payments where id = $1`, [paymentId])).toEqual({
      method: "manual",
      status: "confirmed",
      mpesa_receipt: "ADMP000001",
      phone_e164: "+254712345678",
    });
    expect((await subscription(sub)).status).toBe("active");

    expect((await unresolvedPaybillEvents(db)).map((e) => e.id)).not.toContain(eventId);
    expect((await unmatchedPaybill(db, since)).ids).not.toContain(eventId);
    expect((await getPaybillEvent(db, eventId))?.resolution).toEqual({ kind: "payment", paymentId });
    expect(await applyPaybillToInvoice(deps, admin, { eventId, invoiceNumber: invoice.number, reason: REASON })).toEqual({ ok: false, code: "already_resolved" });
  });

  it("refuses Paybill money that doesn't equal the invoice", async () => {
    const sub = await insertSubscription(await insertUser("adm_l12"), "pending");
    const invoice = await insertInvoice(sub);
    const eventId = await insertPaybillEvent("ADMP000002", "3");
    expect(await applyPaybillToInvoice(deps, admin, { eventId, invoiceNumber: invoice.number, reason: REASON })).toEqual({ ok: false, code: "amount_mismatch" });
    expect((await unresolvedPaybillEvents(db)).map((e) => e.id)).toContain(eventId);
  });

  it("records a refund of unmatched Paybill money", async () => {
    const eventId = await insertPaybillEvent("ADMP000003", "50");
    expect(await refundPaybillEvent(deps, admin, { eventId, reference: "REV999", amountKes: 60, reason: REASON })).toEqual({ ok: false, code: "refund_too_large" });
    expect((await refundPaybillEvent(deps, admin, { eventId, reference: "REV999", amountKes: 50, reason: REASON })).ok).toBe(true);
    expect((await getPaybillEvent(db, eventId))?.resolution).toMatchObject({ kind: "refunded", reference: "REV999" });
    expect((await unresolvedPaybillEvents(db)).map((e) => e.id)).not.toContain(eventId);
    expect(await refundPaybillEvent(deps, admin, { eventId, reference: "REV999", amountKes: 50, reason: REASON })).toEqual({ ok: false, code: "already_resolved" });
    expect((await audits()).filter((a) => a.action === "refund_paybill")).toEqual([expect.objectContaining({ amount_kes: 50, reference: "REV999" })]);
  });

  it("records a Paybill payment from the statement, once per receipt", async () => {
    const sub = await insertSubscription(await insertUser("adm_l13"), "pending");
    const invoice = await insertInvoice(sub);
    const input = { invoiceNumber: invoice.number, receipt: "ADMR000001", amountKes: 2, phoneE164: null, reason: REASON };

    expect((await recordPaybillPayment(deps, admin, input)).ok).toBe(true);
    expect((await subscription(sub)).status).toBe("active");
    const again = await recordPaybillPayment(deps, admin, input);
    expect(again.ok).toBe(false);
    expect((await audits()).filter((a) => a.action === "record_paybill")).toHaveLength(1);
  });
});
