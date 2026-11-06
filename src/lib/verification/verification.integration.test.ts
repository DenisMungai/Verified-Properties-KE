import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { searchListings } from "@/db/queries/public-listings";
import { insertStkPayment } from "@/db/queries/payments";
import * as schema from "@/db/schema";
import { preparePlanInvoice, resolvePurchase } from "@/lib/billing/prepare-invoice";
import { confirmPayment } from "@/lib/mpesa/confirm";
import { DEFAULT_FILTERS } from "@/lib/search/params";
import { createMemoryStore } from "@/test/memory-store";
import { approveRequest, rejectRequest, requestChanges, suspendRequest, type DecisionDeps } from "./decisions";
import { finalizeDocument, removeDocument, requestDocumentUpload, submitForReview, type ListerDeps } from "./lister";

/**
 * S12 verification against the Neon test branch (TEST_DATABASE_URL). Each test runs in a
 * transaction that is rolled back; each step's own transaction is a savepoint. Plan codes (t_ver_*)
 * and user ids (ver_*) differ from other suites.
 */
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
const REASON = "The ID photo is blurred; please upload a clearer scan.";

describe.skipIf(!url)("verification (integration)", { timeout: 90_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let clock: Date;
  let store: ReturnType<typeof createMemoryStore>;
  let listerDeps: ListerDeps;
  let decisionDeps: DecisionDeps;
  let billingDeps: Parameters<typeof preparePlanInvoice>[0];
  let starterId: string;
  let admin: string;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    clock = new Date();
    store = createMemoryStore();
    let savepoint = 0;
    const withTransaction = async <T,>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
      const name = `ver_${++savepoint}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const result = await fn(db);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw error;
      }
    };
    listerDeps = { db, withTransaction, now: () => clock, privateStore: store };
    decisionDeps = { withTransaction, now: () => clock };
    billingDeps = { withTransaction, now: () => clock };
    starterId = await one<{ id: string }>(
      `insert into plans (code, kind, name, price_kes, listing_limit) values ('t_ver_starter', 'listing', 'T Starter', 3, 3) returning id`,
    ).then((r) => r.id);
    await client.query(`insert into plans (code, kind, name, price_kes, listing_limit) values ('t_ver_verify', 'verification', 'T Verification', 1, null)`);
    admin = await insertLister("ver_admin", "owner", false);
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  /* ---------------------------------------------------------------------- */
  /* Fixtures                                                               */
  /* ---------------------------------------------------------------------- */

  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
    (await client.query<T>(sql, params)).rows[0];

  async function insertLister(id: string, type: "agent" | "owner" | "developer", listingPlan = true): Promise<string> {
    await client.query(`insert into users (id, name, email, email_verified) values ($1, $1, $1 || '@ver.test', true)`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, lister_type, phone) values ($1, $1, $2, '+254712000111')`, [id, type]);
    if (listingPlan) {
      await client.query(
        `insert into subscriptions (owner_user_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at)
         values ($1, 'listing', $2, 'active', $3, $4, $5)`,
        [id, starterId, new Date(clock.getTime() - 5 * DAY), new Date(clock.getTime() + 25 * DAY), new Date(clock.getTime() + 28 * DAY)],
      );
    }
    return id;
  }

  /** Checkout for the verification plan, then a confirmed STK payment for it. */
  async function payForVerification(userId: string): Promise<{ invoiceId: string }> {
    const purchase = await resolvePurchase(db, userId, "t_ver_verify", clock);
    if (!purchase.ok) throw new Error(`purchase refused: ${purchase.code}`);
    const prepared = await preparePlanInvoice(billingDeps, purchase.pool, purchase.plan);
    if (!prepared.ok) throw new Error(`invoice refused: ${prepared.code}`);
    const payment = await insertStkPayment(db, {
      invoiceId: prepared.invoice.id,
      phoneE164: "+254712000111",
      checkoutRequestId: `ws_CO_ver_${randomUUID()}`,
      merchantRequestId: `mr_${randomUUID()}`,
      amountKes: prepared.invoice.amountKes,
    });
    const receipt = `TV${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const confirmed = await confirmPayment(db, payment.id, { receipt, paidAmount: prepared.invoice.amountKes, confirmedAt: clock });
    expect(confirmed.outcome).toBe("confirmed");
    return { invoiceId: prepared.invoice.id };
  }

  async function upload(userId: string, documentType: "national_id" | "earb_certificate" | "business_registration"): Promise<string> {
    const issued = await requestDocumentUpload(listerDeps, { userId, documentType, contentType: "application/pdf", size: PDF.length });
    if (!issued.ok) throw new Error(issued.message);
    await store.put(issued.uploadKey, PDF, "application/pdf");
    const done = await finalizeDocument(listerDeps, { userId, uploadKey: issued.uploadKey, documentType, fileName: `${documentType}.pdf` });
    if (!done.ok) throw new Error(done.message);
    return done.documentId;
  }

  async function submitted(userId: string): Promise<string> {
    await payForVerification(userId);
    await upload(userId, "national_id");
    await upload(userId, "earb_certificate");
    const result = await submitForReview(listerDeps, userId);
    expect(result.ok).toBe(true);
    return (await requestOf(userId)).id;
  }

  const requestOf = (userId: string) =>
    one<{ id: string; status: string; invoice_id: string | null; decision_reason: string | null; review_expires_at: Date | null }>(
      `select id, status, invoice_id, decision_reason, review_expires_at from verification_requests where lister_user_id = $1
       order by created_at desc, status in ('payment_pending', 'documents_pending', 'under_review') desc limit 1`,
      [userId],
    );
  const verifiedNow = async (userId: string) => (await one<{ v: boolean }>(`select lister_verified_now($1) as v`, [userId])).v;
  const auditActions = async (requestId: string) =>
    (await client.query<{ action: string }>(`select action from verification_audit_log where request_id = $1 order by created_at, id`, [requestId])).rows.map(
      (r) => r.action,
    );
  const countRequests = async (userId: string) =>
    (await one<{ n: number }>(`select count(*)::int as n from verification_requests where lister_user_id = $1`, [userId])).n;

  /* ---------------------------------------------------------------------- */
  /* Paying                                                                 */
  /* ---------------------------------------------------------------------- */

  it("checkout opens a payment_pending request at the plan's price; payment moves it to documents_pending once", async () => {
    const lister = await insertLister("ver_a", "agent");
    const purchase = await resolvePurchase(db, lister, "t_ver_verify", clock);
    expect(purchase.ok).toBe(true);
    if (!purchase.ok) return;
    expect(purchase.pool).toEqual({ kind: "user", userId: lister });
    const prepared = await preparePlanInvoice(billingDeps, purchase.pool, purchase.plan);
    expect(prepared.ok && prepared.invoice.amountKes).toBe(1);
    const pending = await requestOf(lister);
    expect(pending.status).toBe("payment_pending");
    expect(pending.invoice_id).toBe(prepared.ok ? prepared.invoice.id : null);
    expect(await auditActions(pending.id)).toEqual(["start"]);

    const payment = await insertStkPayment(db, {
      invoiceId: pending.invoice_id!,
      phoneE164: "+254712000111",
      checkoutRequestId: `ws_CO_ver_${randomUUID()}`,
      merchantRequestId: "mr_1",
      amountKes: 1,
    });
    const receipt = `TV${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    expect((await confirmPayment(db, payment.id, { receipt, paidAmount: 1, confirmedAt: clock })).outcome).toBe("confirmed");
    expect((await confirmPayment(db, payment.id, { receipt, paidAmount: 1, confirmedAt: clock })).outcome).toBe("already_confirmed");
    expect((await requestOf(lister)).status).toBe("documents_pending");
    expect(await auditActions(pending.id)).toEqual(["start", "pay"]);
    expect(await verifiedNow(lister)).toBe(false);
  });

  it("refuses verification without an active listing plan", async () => {
    const lister = await insertLister("ver_noplan", "owner", false);
    expect(await resolvePurchase(db, lister, "t_ver_verify", clock)).toEqual({ ok: false, code: "listing_plan_required" });
  });

  /* ---------------------------------------------------------------------- */
  /* Documents and submit                                                   */
  /* ---------------------------------------------------------------------- */

  it("refuses submit until every required type is uploaded, then goes under review", async () => {
    const lister = await insertLister("ver_b", "agent");
    await payForVerification(lister);
    await upload(lister, "national_id");
    expect(await submitForReview(listerDeps, lister)).toMatchObject({ ok: false, code: "missing_documents" });
    await upload(lister, "earb_certificate");
    expect(await submitForReview(listerDeps, lister)).toEqual({ ok: true });
    const request = await requestOf(lister);
    expect(request.status).toBe("under_review");
    expect(await auditActions(request.id)).toEqual(["start", "pay", "upload", "upload", "submit"]);
    // Once submitted, no more uploads.
    expect(await requestDocumentUpload(listerDeps, { userId: lister, documentType: "national_id", contentType: "application/pdf", size: 10 })).toMatchObject({
      ok: false,
      code: "not_accepting",
    });
    // Documents live only under verification/<user>/<request>/ in the private store; temp uploads are gone.
    const keys = [...store.objects.keys()];
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key.startsWith(`verification/${lister}/${request.id}/`))).toBe(true);
  });

  it("refuses a fake PDF and deletes the upload", async () => {
    const lister = await insertLister("ver_fake", "owner");
    await payForVerification(lister);
    const issued = await requestDocumentUpload(listerDeps, { userId: lister, documentType: "national_id", contentType: "application/pdf", size: 5 });
    if (!issued.ok) throw new Error(issued.message);
    await store.put(issued.uploadKey, Buffer.from("hello"), "application/pdf");
    const done = await finalizeDocument(listerDeps, { userId: lister, uploadKey: issued.uploadKey, documentType: "national_id", fileName: "id.pdf" });
    expect(done).toMatchObject({ ok: false, code: "rejected" });
    expect(store.objects.size).toBe(0);
  });

  /* ---------------------------------------------------------------------- */
  /* Decisions                                                              */
  /* ---------------------------------------------------------------------- */

  it("approval verifies the lister: badge, ranking first, and a 12-month review", async () => {
    const lister = await insertLister("ver_c", "agent");
    const other = await insertLister("ver_d", "agent");
    const requestId = await submitted(lister);
    expect(await verifiedNow(lister)).toBe(false);

    expect(await approveRequest(decisionDeps, admin, requestId)).toEqual({ ok: true, listerUserId: lister });
    const request = await requestOf(lister);
    expect(request.status).toBe("verified");
    expect(request.review_expires_at!.getTime()).toBeGreaterThan(clock.getTime() + 360 * DAY);
    expect(await verifiedNow(lister)).toBe(true);
    expect(await auditActions(requestId)).toContain("approve");

    // Ranking reads the same derived rule: the verified lister's listing comes first.
    const token = `Tver${randomUUID().slice(0, 8)}`;
    for (const [owner, age] of [
      [other, 1],
      [lister, 5],
    ] as const) {
      await client.query(
        `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, bedrooms, bathrooms,
           county, town, neighbourhood, exact_latitude, exact_longitude, status, published_at)
         values ($1, $2, $3, 'A described listing for verification tests.', 'sale', 'house', 1000000, 3, 2,
           'Nairobi', $4, 'Kilimani', -1.29, 36.82, 'published', $5)`,
        [`t-ver-${owner}-${token}`, owner, `${token} house by ${owner}`, token, new Date(clock.getTime() - age * DAY)],
      );
    }
    const result = await searchListings(db, { ...DEFAULT_FILTERS, q: token }, clock);
    expect(result.items.map((item) => item.slug)).toEqual([`t-ver-${lister}-${token}`, `t-ver-${other}-${token}`]);
    expect(result.items[0].verified).toBe(true);
  });

  it("a lapsed verification payment hides the badge; renewing restores it with no new review", async () => {
    const lister = await insertLister("ver_e", "agent");
    const requestId = await submitted(lister);
    await approveRequest(decisionDeps, admin, requestId);
    expect(await verifiedNow(lister)).toBe(true);

    await client.query(
      `update subscriptions set current_period_start = $2, current_period_end = $3, grace_ends_at = $4, status = 'past_due'
       where owner_user_id = $1 and kind = 'verification'`,
      [lister, new Date(clock.getTime() - 35 * DAY), new Date(clock.getTime() - 5 * DAY), new Date(clock.getTime() - 2 * DAY)],
    );
    expect(await verifiedNow(lister)).toBe(false);

    await payForVerification(lister);
    expect(await verifiedNow(lister)).toBe(true);
    expect(await countRequests(lister)).toBe(1);
    expect((await requestOf(lister)).status).toBe("verified");
  });

  it("request changes sends it back with the reason; the lister can re-upload", async () => {
    const lister = await insertLister("ver_f", "agent");
    const requestId = await submitted(lister);
    expect((await requestChanges(decisionDeps, admin, requestId, REASON)).ok).toBe(true);
    const request = await requestOf(lister);
    expect(request.status).toBe("documents_pending");
    expect(request.decision_reason).toBe(REASON);
    const documentId = (await one<{ id: string }>(`select id from verification_documents where request_id = $1 limit 1`, [requestId])).id;
    expect(await removeDocument(listerDeps, { userId: lister, documentId })).toEqual({ ok: true });
    expect(await auditActions(requestId)).toEqual(["start", "pay", "upload", "upload", "submit", "request_changes", "remove_document"]);
  });

  it("rejection credits the listing plan once, cancels the verification subscription and logs both", async () => {
    const lister = await insertLister("ver_g", "agent");
    const requestId = await submitted(lister);
    const before = await one<{ end: Date }>(`select current_period_end as end from subscriptions where owner_user_id = $1 and kind = 'listing'`, [lister]);

    const result = await rejectRequest(decisionDeps, admin, requestId, REASON);
    // KES 1 paid against a KES 3 / 30-day listing plan = 10 days.
    expect(result).toEqual({ ok: true, listerUserId: lister, credit: { kind: "credited", days: 10 } });
    const after = await one<{ end: Date }>(`select current_period_end as end from subscriptions where owner_user_id = $1 and kind = 'listing'`, [lister]);
    expect(after.end.getTime() - before.end.getTime()).toBe(10 * DAY);
    const billing = await one<{ action: string; credit_days: number; actor_user_id: string }>(
      `select action, credit_days, actor_user_id from billing_audit_log where invoice_id = $1`,
      [(await requestOf(lister)).invoice_id],
    );
    expect(billing).toEqual({ action: "verification_credit", credit_days: 10, actor_user_id: admin });
    const verificationSub = await one<{ status: string }>(`select status from subscriptions where owner_user_id = $1 and kind = 'verification'`, [lister]);
    expect(verificationSub.status).toBe("cancelled");
    expect(await auditActions(requestId)).toEqual(["start", "pay", "upload", "upload", "submit", "reject", "credit"]);

    // A second rejection (double click, second admin) changes nothing.
    expect(await rejectRequest(decisionDeps, admin, requestId, REASON)).toMatchObject({ ok: false, code: "conflict" });
    const again = await one<{ end: Date }>(`select current_period_end as end from subscriptions where owner_user_id = $1 and kind = 'listing'`, [lister]);
    expect(again.end.getTime()).toBe(after.end.getTime());

    // Applying again after a rejection opens a fresh request.
    await payForVerification(lister);
    expect(await countRequests(lister)).toBe(2);
    expect((await requestOf(lister)).status).toBe("documents_pending");
  });

  it("suspension removes the badge at once", async () => {
    const lister = await insertLister("ver_h", "agent");
    const requestId = await submitted(lister);
    await approveRequest(decisionDeps, admin, requestId);
    expect(await verifiedNow(lister)).toBe(true);
    expect((await suspendRequest(decisionDeps, admin, requestId, "Reported for misusing another agent's licence.")).ok).toBe(true);
    expect(await verifiedNow(lister)).toBe(false);
    expect(await resolvePurchase(db, lister, "t_ver_verify", clock)).toEqual({ ok: false, code: "verification_suspended" });
  });

  /* ---------------------------------------------------------------------- */
  /* Access                                                                 */
  /* ---------------------------------------------------------------------- */

  it("blocks self-review and cross-user access to uploads and documents", async () => {
    const a = await insertLister("ver_i", "agent");
    const b = await insertLister("ver_j", "agent");
    const requestId = await submitted(a);
    expect(await approveRequest(decisionDeps, a, requestId)).toMatchObject({ ok: false, code: "self_review" });

    await payForVerification(b);
    // B can't finalize an upload key issued to A, nor remove A's document.
    const issuedToA = `uploads/${a}/verification/${randomUUID()}`;
    await store.put(issuedToA, PDF, "application/pdf");
    expect(await finalizeDocument(listerDeps, { userId: b, uploadKey: issuedToA, documentType: "national_id", fileName: "x.pdf" })).toMatchObject({
      ok: false,
      code: "invalid_upload",
    });
    const documentOfA = (await one<{ id: string }>(`select id from verification_documents where request_id = $1 limit 1`, [requestId])).id;
    expect(await removeDocument(listerDeps, { userId: b, documentId: documentOfA })).toMatchObject({ ok: false, code: "not_found" });
    expect((await one<{ n: number }>(`select count(*)::int as n from verification_documents where id = $1`, [documentOfA])).n).toBe(1);

    // A lister with no request gets nothing.
    const c = await insertLister("ver_k", "owner");
    expect(await requestDocumentUpload(listerDeps, { userId: c, documentType: "national_id", contentType: "application/pdf", size: 10 })).toMatchObject({
      ok: false,
      code: "no_request",
    });
  });

  it("keeps the audit log append-only", async () => {
    const lister = await insertLister("ver_l", "owner");
    await payForVerification(lister);
    const requestId = (await requestOf(lister)).id;
    await client.query("SAVEPOINT audit_update");
    await expect(client.query(`update verification_audit_log set reason = 'x' where request_id = $1`, [requestId])).rejects.toThrow(/append-only/);
    await client.query("ROLLBACK TO SAVEPOINT audit_update");
    await expect(client.query(`delete from verification_audit_log where request_id = $1`, [requestId])).rejects.toThrow(/append-only/);
  });
});
