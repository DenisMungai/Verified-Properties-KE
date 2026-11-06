import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { recordListingView } from "@/db/queries/listing-views";
import { viewsByListing } from "@/db/queries/lister-stats";
import { insertStkPayment } from "@/db/queries/payments";
import * as schema from "@/db/schema";
import { preparePlanInvoice, resolvePurchase } from "@/lib/billing/prepare-invoice";
import type { EmailMessage } from "@/lib/email/send";
import { runRenewalReminders } from "@/lib/jobs/renewal-reminders";
import type { JobDeps } from "@/lib/jobs/types";
import { runVerificationLifecycle } from "@/lib/jobs/verification-lifecycle";
import { confirmPayment } from "@/lib/mpesa/confirm";
import { POLICIES, checkRateLimits, createMemoryLimiter, rateLimitKey } from "@/lib/rate-limit";
import type { SmsMessage, SmsTransport } from "@/lib/sms/send";
import { nairobiDay } from "@/lib/stats/engagement";
import { loadListerStats } from "@/lib/stats/load";
import { createMemoryStore } from "@/test/memory-store";
import { approveRequest, rejectRequest, suspendRequest, SUSPENSION_CLOSURE_REASON, type DecisionDeps } from "./decisions";
import { finalizeDocument, requestDocumentUpload, submitForReview, type ListerDeps } from "./lister";
import { startRereview } from "./rereview";

/**
 * S13 verification lifecycle against the Neon test branch (TEST_DATABASE_URL): expiry, re-review,
 * reminders, retention, verification-plan renewal reminders and property views. Each test runs in
 * a transaction that is rolled back. The badge view reads the database clock, so tests move
 * review dates relative to real time instead of moving the app clock. Plan codes (t_lc_*) and user
 * ids (lc_*) are unique to this suite; the jobs read globally, so assertions are about own rows.
 */
const url = process.env.TEST_DATABASE_URL;
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
const PHONE = "+254712000222";

describe.skipIf(!url)("verification lifecycle (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let clock: Date;
  let store: ReturnType<typeof createMemoryStore>;
  let emails: EmailMessage[];
  let texts: SmsMessage[];
  let listerDeps: ListerDeps;
  let decisionDeps: DecisionDeps;
  let billingDeps: Parameters<typeof preparePlanInvoice>[0];
  let jobDeps: JobDeps;
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
    emails = [];
    texts = [];
    let savepoint = 0;
    const withTransaction = async <T,>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
      const name = `lc_${++savepoint}`;
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
    const sms: SmsTransport = async (message) => {
      texts.push(message);
      return { status: "sent" };
    };
    listerDeps = { db, withTransaction, now: () => clock, privateStore: store };
    decisionDeps = { withTransaction, now: () => clock };
    billingDeps = { withTransaction, now: () => clock };
    jobDeps = {
      db,
      withTransaction,
      now: () => clock,
      email: async (message: EmailMessage) => {
        emails.push(message);
      },
      appUrl: "https://app.example",
      sms,
      payments: null,
      card: null,
      storage: { public: createMemoryStore(), private: store },
      batchSize: 1000,
    };
    starterId = await one<{ id: string }>(
      `insert into plans (code, kind, name, price_kes, listing_limit) values ('t_lc_starter', 'listing', 'T Starter', 3, 3) returning id`,
    ).then((r) => r.id);
    await client.query(`insert into plans (code, kind, name, price_kes, listing_limit) values ('t_lc_verify', 'verification', 'T Verification', 1, null)`);
    admin = await insertLister("lc_admin", "owner", false);
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
    await client.query(`insert into users (id, name, email, email_verified) values ($1, $1, $1 || '@lc.test', true)`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, lister_type, phone) values ($1, $1, $2, $3)`, [id, type, PHONE]);
    if (listingPlan) {
      await client.query(
        `insert into subscriptions (owner_user_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at)
         values ($1, 'listing', $2, 'active', $3, $4, $5)`,
        [id, starterId, new Date(clock.getTime() - 5 * DAY), new Date(clock.getTime() + 25 * DAY), new Date(clock.getTime() + 28 * DAY)],
      );
    }
    return id;
  }

  async function payForVerification(userId: string): Promise<void> {
    const purchase = await resolvePurchase(db, userId, "t_lc_verify", clock);
    if (!purchase.ok) throw new Error(`purchase refused: ${purchase.code}`);
    const prepared = await preparePlanInvoice(billingDeps, purchase.pool, purchase.plan);
    if (!prepared.ok) throw new Error(`invoice refused: ${prepared.code}`);
    const payment = await insertStkPayment(db, {
      invoiceId: prepared.invoice.id,
      phoneE164: PHONE,
      checkoutRequestId: `ws_CO_lc_${randomUUID()}`,
      merchantRequestId: `mr_${randomUUID()}`,
      amountKes: prepared.invoice.amountKes,
    });
    const receipt = `TL${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const confirmed = await confirmPayment(db, payment.id, { receipt, paidAmount: prepared.invoice.amountKes, confirmedAt: clock });
    expect(confirmed.outcome).toBe("confirmed");
  }

  async function uploadAndSubmit(userId: string): Promise<void> {
    for (const documentType of ["national_id", "earb_certificate"] as const) {
      const issued = await requestDocumentUpload(listerDeps, { userId, documentType, contentType: "application/pdf", size: PDF.length });
      if (!issued.ok) throw new Error(issued.message);
      await store.put(issued.uploadKey, PDF, "application/pdf");
      const done = await finalizeDocument(listerDeps, { userId, uploadKey: issued.uploadKey, documentType, fileName: `${documentType}.pdf` });
      if (!done.ok) throw new Error(done.message);
    }
    expect(await submitForReview(listerDeps, userId)).toEqual({ ok: true });
  }

  /** A verified agent: paid, uploaded, submitted and approved. Returns the request id. */
  async function verifiedLister(id: string): Promise<string> {
    const lister = await insertLister(id, "agent");
    await payForVerification(lister);
    await uploadAndSubmit(lister);
    const requestId = (await latest(lister)).id;
    expect((await approveRequest(decisionDeps, admin, requestId)).ok).toBe(true);
    return requestId;
  }

  const latest = (userId: string) =>
    one<{ id: string; status: string; renews_request_id: string | null; review_expires_at: Date | null }>(
      `select id, status, renews_request_id, review_expires_at from verification_requests where lister_user_id = $1
       order by created_at desc, status in ('payment_pending', 'documents_pending', 'under_review') desc limit 1`,
      [userId],
    );
  const request = (id: string) =>
    one<{ status: string; ended_at: Date | null; documents_purged_at: Date | null; review_expires_at: Date | null }>(
      `select status, ended_at, documents_purged_at, review_expires_at from verification_requests where id = $1`,
      [id],
    );
  const setExpiry = (id: string, at: Date) => client.query(`update verification_requests set review_expires_at = $2 where id = $1`, [id, at]);
  const verifiedNow = async (userId: string) => (await one<{ v: boolean }>(`select lister_verified_now($1) as v`, [userId])).v;
  const auditActions = async (requestId: string) =>
    (await client.query<{ action: string }>(`select action from verification_audit_log where request_id = $1 order by created_at, id`, [requestId])).rows.map(
      (r) => r.action,
    );
  const documentCount = async (requestId: string) =>
    (await one<{ n: number }>(`select count(*)::int as n from verification_documents where request_id = $1`, [requestId])).n;
  const mailTo = (userId: string) => emails.filter((e) => e.to === `${userId}@lc.test`);

  /* ---------------------------------------------------------------------- */
  /* Expiry                                                                 */
  /* ---------------------------------------------------------------------- */

  it("expires a review past its date once, with audit and one email", async () => {
    const requestId = await verifiedLister("lc_exp");
    const ended = new Date(clock.getTime() - MIN);
    await setExpiry(requestId, ended);
    expect(await verifiedNow("lc_exp")).toBe(false);

    await runVerificationLifecycle(jobDeps);
    const row = await request(requestId);
    expect(row.status).toBe("expired");
    expect(row.ended_at?.getTime()).toBe(ended.getTime());
    expect((await auditActions(requestId)).at(-1)).toBe("expire");
    expect(mailTo("lc_exp").map((e) => e.subject)).toEqual(["Your verification review has ended"]);

    await runVerificationLifecycle(jobDeps);
    expect(mailTo("lc_exp")).toHaveLength(1);
    expect((await auditActions(requestId)).filter((a) => a === "expire")).toHaveLength(1);
  });

  /* ---------------------------------------------------------------------- */
  /* Re-review reminders                                                    */
  /* ---------------------------------------------------------------------- */

  it("sends the 30-day and 7-day re-review reminders once each, by email and SMS", async () => {
    const requestId = await verifiedLister("lc_rem");
    await setExpiry(requestId, new Date(clock.getTime() + 29 * DAY));
    await runVerificationLifecycle(jobDeps);
    expect(mailTo("lc_rem").map((e) => e.subject)).toEqual(["Your verification review ends in 30 days"]);
    expect(mailTo("lc_rem")[0].text).toContain("https://app.example/account/verification");
    expect(texts.filter((t) => t.to === PHONE)).toHaveLength(1);

    await runVerificationLifecycle(jobDeps);
    expect(mailTo("lc_rem")).toHaveLength(1);

    await setExpiry(requestId, new Date(clock.getTime() + 6 * DAY));
    await runVerificationLifecycle(jobDeps);
    expect(mailTo("lc_rem").map((e) => e.subject)).toEqual([
      "Your verification review ends in 30 days",
      "Your verification review ends in 7 days",
    ]);
    expect(texts.filter((t) => t.to === PHONE)).toHaveLength(2);
  });

  it("sends no reminder while a re-review is under way", async () => {
    const requestId = await verifiedLister("lc_quiet");
    await setExpiry(requestId, new Date(clock.getTime() + 20 * DAY));
    expect((await startRereview(decisionDeps, "lc_quiet")).ok).toBe(true);
    await runVerificationLifecycle(jobDeps);
    expect(mailTo("lc_quiet")).toHaveLength(0);
  });

  /* ---------------------------------------------------------------------- */
  /* Re-review                                                              */
  /* ---------------------------------------------------------------------- */

  it("opens a free re-review 30 days out; approval replaces the old review and the badge never drops", async () => {
    const oldId = await verifiedLister("lc_rr");
    await setExpiry(oldId, new Date(clock.getTime() + 31 * DAY));
    expect(await startRereview(decisionDeps, "lc_rr")).toMatchObject({ ok: false, code: "too_early" });

    await setExpiry(oldId, new Date(clock.getTime() + 30 * DAY - MIN));
    const started = await startRereview(decisionDeps, "lc_rr");
    expect(started.ok).toBe(true);
    const rereview = await latest("lc_rr");
    expect(rereview).toMatchObject({ status: "documents_pending", renews_request_id: oldId });
    expect(await auditActions(rereview.id)).toEqual(["rereview"]);
    expect(await verifiedNow("lc_rr")).toBe(true);
    expect(await startRereview(decisionDeps, "lc_rr")).toMatchObject({ ok: false, code: "request_open" });

    await uploadAndSubmit("lc_rr");
    expect(await verifiedNow("lc_rr")).toBe(true);
    expect(await approveRequest(decisionDeps, admin, rereview.id)).toEqual({ ok: true, listerUserId: "lc_rr", rereview: true });

    const old = await request(oldId);
    expect(old.status).toBe("expired");
    expect(old.ended_at?.getTime()).toBe(clock.getTime());
    expect((await auditActions(oldId)).at(-1)).toBe("supersede");
    const fresh = await request(rereview.id);
    expect(fresh.status).toBe("verified");
    expect(fresh.review_expires_at!.getTime()).toBeGreaterThan(clock.getTime() + 360 * DAY);
    expect(await verifiedNow("lc_rr")).toBe(true);
    // The replaced review is never expired (or mailed) again by the job.
    await runVerificationLifecycle(jobDeps);
    expect(mailTo("lc_rr")).toHaveLength(0);
  });

  it("refuses a re-review with a lapsed verification plan or after a suspension", async () => {
    const requestId = await verifiedLister("lc_rr_no");
    await setExpiry(requestId, new Date(clock.getTime() + 10 * DAY));
    await client.query(
      `update subscriptions set current_period_start = $2, current_period_end = $3, grace_ends_at = $4, status = 'past_due'
       where owner_user_id = $1 and kind = 'verification'`,
      ["lc_rr_no", new Date(clock.getTime() - 35 * DAY), new Date(clock.getTime() - 5 * DAY), new Date(clock.getTime() - 2 * DAY)],
    );
    expect(await startRereview(decisionDeps, "lc_rr_no")).toMatchObject({ ok: false, code: "verification_plan_inactive" });

    const suspendedId = await verifiedLister("lc_rr_susp");
    await setExpiry(suspendedId, new Date(clock.getTime() + 10 * DAY));
    expect((await suspendRequest(decisionDeps, admin, suspendedId, "Reported for misusing another agent's licence.")).ok).toBe(true);
    expect(await startRereview(decisionDeps, "lc_rr_susp")).toMatchObject({ ok: false, code: "suspended" });
  });

  it("a rejected re-review gives no credit and leaves the current badge and billing alone", async () => {
    const oldId = await verifiedLister("lc_rr_rej");
    await setExpiry(oldId, new Date(clock.getTime() + 15 * DAY));
    await startRereview(decisionDeps, "lc_rr_rej");
    await uploadAndSubmit("lc_rr_rej");
    const rereviewId = (await latest("lc_rr_rej")).id;

    const result = await rejectRequest(decisionDeps, admin, rereviewId, "The EARB certificate has expired.");
    expect(result).toEqual({ ok: true, listerUserId: "lc_rr_rej", rereview: true });
    expect(await auditActions(rereviewId)).toEqual(["rereview", "upload", "upload", "submit", "reject"]);
    expect((await one<{ n: number }>(`select count(*)::int as n from billing_audit_log where actor_user_id = $1 and created_at >= $2`, [admin, clock])).n).toBe(0);
    expect((await one<{ status: string }>(`select status from subscriptions where owner_user_id = $1 and kind = 'verification'`, ["lc_rr_rej"])).status).toBe("active");
    expect((await request(oldId)).status).toBe("verified");
    expect(await verifiedNow("lc_rr_rej")).toBe(true);
    // They may try again.
    expect((await startRereview(decisionDeps, "lc_rr_rej")).ok).toBe(true);
  });

  it("suspending closes an open re-review", async () => {
    const oldId = await verifiedLister("lc_rr_close");
    await setExpiry(oldId, new Date(clock.getTime() + 15 * DAY));
    await startRereview(decisionDeps, "lc_rr_close");
    const rereviewId = (await latest("lc_rr_close")).id;

    expect((await suspendRequest(decisionDeps, admin, oldId, "Reported for misusing another agent's licence.")).ok).toBe(true);
    const closed = await one<{ status: string; decision_reason: string }>(`select status, decision_reason from verification_requests where id = $1`, [rereviewId]);
    expect(closed).toEqual({ status: "rejected", decision_reason: SUSPENSION_CLOSURE_REASON });
    expect(await auditActions(rereviewId)).toEqual(["rereview", "reject"]);
    expect(await verifiedNow("lc_rr_close")).toBe(false);
  });

  /* ---------------------------------------------------------------------- */
  /* Retention                                                              */
  /* ---------------------------------------------------------------------- */

  it("deletes a rejected request's documents 90 days after the decision, once", async () => {
    const lister = await insertLister("lc_ret", "agent");
    await payForVerification(lister);
    await uploadAndSubmit(lister);
    const requestId = (await latest(lister)).id;
    await rejectRequest(decisionDeps, admin, requestId, "The ID photo is unreadable.");
    const keys = [...store.objects.keys()].filter((k) => k.includes(requestId));
    expect(keys).toHaveLength(2);

    await client.query(`update verification_requests set decided_at = $2 where id = $1`, [requestId, new Date(clock.getTime() - 89 * DAY)]);
    await runVerificationLifecycle(jobDeps);
    expect(await documentCount(requestId)).toBe(2);

    await client.query(`update verification_requests set decided_at = $2 where id = $1`, [requestId, new Date(clock.getTime() - 90 * DAY - MIN)]);
    await runVerificationLifecycle(jobDeps);
    expect(await documentCount(requestId)).toBe(0);
    expect((await request(requestId)).documents_purged_at?.getTime()).toBe(clock.getTime());
    expect((await auditActions(requestId)).at(-1)).toBe("purge_documents");
    expect(keys.some((key) => store.objects.has(key))).toBe(false);

    await runVerificationLifecycle(jobDeps);
    expect((await auditActions(requestId)).filter((a) => a === "purge_documents")).toHaveLength(1);
  });

  it("measures expired reviews from when they ended, and keeps suspended files 24 months", async () => {
    const expiredId = await verifiedLister("lc_ret_exp");
    // Expired 91 days ago: one run records the expiry, then the retention step deletes the files.
    await setExpiry(expiredId, new Date(clock.getTime() - 91 * DAY));
    await runVerificationLifecycle(jobDeps);
    expect((await request(expiredId)).status).toBe("expired");
    expect(await documentCount(expiredId)).toBe(0);

    const suspendedId = await verifiedLister("lc_ret_susp");
    await suspendRequest(decisionDeps, admin, suspendedId, "Reported for misusing another agent's licence.");
    const monthsAgo = (m: number) => {
      const d = new Date(clock);
      d.setUTCMonth(d.getUTCMonth() - m);
      return d;
    };
    await client.query(`update verification_requests set decided_at = $2 where id = $1`, [suspendedId, monthsAgo(23)]);
    await runVerificationLifecycle(jobDeps);
    expect(await documentCount(suspendedId)).toBe(2);
    await client.query(`update verification_requests set decided_at = $2 where id = $1`, [suspendedId, monthsAgo(24)]);
    await runVerificationLifecycle(jobDeps);
    expect(await documentCount(suspendedId)).toBe(0);
    // Two listers and four job runs over the network: allow longer than the suite default.
  }, 300_000);

  /* ---------------------------------------------------------------------- */
  /* Verification-plan renewal reminders                                    */
  /* ---------------------------------------------------------------------- */

  it("reminds about a verification plan ending, in its own words; a cancelled one gets nothing", async () => {
    await verifiedLister("lc_vrem");
    await client.query(`update subscriptions set current_period_end = $2, grace_ends_at = $3 where owner_user_id = $1 and kind = 'verification'`, [
      "lc_vrem",
      new Date(clock.getTime() + 4 * DAY),
      new Date(clock.getTime() + 7 * DAY),
    ]);
    // Keep the listing plan clear of the window so only the verification plan is due.
    await runRenewalReminders(jobDeps);
    const mine = mailTo("lc_vrem");
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe("Your T Verification plan ends in 5 days");
    expect(mine[0].text).toContain("Profile verified");

    // A cancelled verification plan in the same window gets nothing.
    await insertLister("lc_vrem_c", "agent");
    await client.query(
      `insert into subscriptions (owner_user_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at, cancelled_at)
       select $1, 'verification', id, 'cancelled', $2, $3, $4, $5 from plans where code = 't_lc_verify'`,
      ["lc_vrem_c", new Date(clock.getTime() - 26 * DAY), new Date(clock.getTime() + 4 * DAY), new Date(clock.getTime() + 7 * DAY), clock],
    );
    await runRenewalReminders(jobDeps);
    expect(mailTo("lc_vrem_c")).toHaveLength(0);
  }, 300_000);

  /* ---------------------------------------------------------------------- */
  /* Property views and stats                                               */
  /* ---------------------------------------------------------------------- */

  async function insertListing(owner: string, status: "published" | "draft"): Promise<string> {
    const slug = `t-lc-${owner}-${randomUUID().slice(0, 8)}`;
    return one<{ id: string }>(
      `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, bedrooms, bathrooms,
         county, town, neighbourhood, exact_latitude, exact_longitude, status, published_at)
       values ($1, $2, 'A test house', 'A described listing for lifecycle tests.', 'sale', 'house', 1000000, 3, 2,
         'Nairobi', 'Nairobi', 'Kilimani', -1.29, 36.82, $3, $4)
       returning id`,
      [slug, owner, status, status === "published" ? clock : null],
    ).then((r) => r.id);
  }

  it("counts views on published listings only, never the owner's, on the Nairobi day", async () => {
    const owner = await insertLister("lc_views", "owner");
    const other = await insertLister("lc_views_b", "owner");
    const live = await insertListing(owner, "published");
    const draft = await insertListing(owner, "draft");
    const today = nairobiDay(clock);

    await recordListingView(db, live, today, null);
    await recordListingView(db, live, today, other);
    await recordListingView(db, live, today, owner);
    await recordListingView(db, draft, today, null);
    const rows = (await client.query<{ property_id: string; day: string; views: number }>(
      `select property_id, to_char(day, 'YYYY-MM-DD') as day, views from listing_view_days where property_id = any($1)`,
      [[live, draft]],
    )).rows;
    expect(rows).toEqual([{ property_id: live, day: today, views: 2 }]);

    // One count per visitor and listing per 30 minutes.
    const limiter = createMemoryLimiter();
    const key = rateLimitKey("visitor-hash");
    expect((await checkRateLimits([[POLICIES.listingViewPerVisitor, key]], limiter)).ok).toBe(true);
    expect((await checkRateLimits([[POLICIES.listingViewPerVisitor, key]], limiter)).ok).toBe(false);
  });

  it("totals a lister's own enquiries and views only", async () => {
    const a = await insertLister("lc_stats_a", "owner");
    const b = await insertLister("lc_stats_b", "owner");
    const buyer = await insertLister("lc_stats_buyer", "owner", false);
    const listingA = await insertListing(a, "published");
    const listingB = await insertListing(b, "published");
    for (const [listing, day, views] of [
      [listingA, nairobiDay(new Date(clock.getTime() - 2 * DAY)), 7],
      [listingA, nairobiDay(new Date(clock.getTime() - 40 * DAY)), 4],
      [listingB, nairobiDay(clock), 50],
    ] as const) {
      await client.query(`insert into listing_view_days (property_id, day, views) values ($1, $2, $3)`, [listing, day, views]);
    }
    for (const at of [new Date(clock.getTime() - DAY), new Date(clock.getTime() - 3 * DAY), new Date(clock.getTime() - 45 * DAY)]) {
      await client.query(
        `insert into inquiries (property_id, sender_user_id, recipient_user_id, full_name, email, message, created_at)
         values ($1, $2, $3, 'Buyer', 'buyer@lc.test', 'Is it still available?', $4)`,
        [listingA, buyer, a, at],
      );
    }

    const stats = await loadListerStats(db, a, clock);
    expect(stats.enquiries.total).toBe(2);
    expect(stats.enquiries.change).toEqual({ kind: "up", percent: 100 });
    expect(stats.views.total).toBe(7);
    expect(stats.comparison).toEqual({ kind: "none" });
    const perListing = await viewsByListing(db, a, [listingA, listingB], nairobiDay(new Date(clock.getTime() - 30 * DAY)), nairobiDay(clock));
    expect([...perListing.entries()]).toEqual([[listingA, 7]]);
  });
});
