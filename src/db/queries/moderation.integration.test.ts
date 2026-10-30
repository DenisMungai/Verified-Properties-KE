import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import {
  adminCounts,
  approveListing,
  dismissReport,
  getListingForReview,
  moderationHistory,
  moderationQueue,
  rejectListing,
  takeDownForReport,
} from "./moderation";

/**
 * Admin moderation against the Neon test branch (TEST_DATABASE_URL). Every test runs in a
 * transaction that is rolled back; now() is fixed inside it. Fixture ids are prefixed s8m_ and the
 * plan code is unique to this suite.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("moderation (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let planId: string;
  let slugCounter = 0;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    planId = await one(
      `insert into plans (code, kind, name, price_kes, listing_limit) values ('t_s8m_list', 'listing', 'L', 1, 10) returning id`,
    );
    for (const id of ["s8m_admin", "s8m_lister", "s8m_lapsed", "s8m_buyer", "s8m_buyer2"]) {
      await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
      await client.query(`insert into lister_profiles (user_id, display_name) values ($1, $2)`, [id, `Lister ${id}`]);
    }
    await insertSubscription("s8m_lister", "10 days");
    await insertSubscription("s8m_lapsed", "-10 days");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function one(statement: string, params: unknown[] = []): Promise<string> {
    return (await client.query<{ id: string }>(statement, params)).rows[0].id;
  }

  /** A paid listing plan whose period ends `endsIn` from now (grace is 3 days after). */
  async function insertSubscription(userId: string, endsIn: string) {
    await client.query(
      `insert into subscriptions (owner_user_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at)
       values ($1, 'listing', $2, 'active', now() + $3::interval - interval '30 days', now() + $3::interval,
               now() + $3::interval + interval '3 days')`,
      [userId, planId, endsIn],
    );
  }

  async function insertListing(owner: string, status = "pending_review", publishedAt: string | null = null): Promise<string> {
    slugCounter += 1;
    return one(
      `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town, status, published_at)
       values ($1, $2, $3, 'A described listing used by the moderation tests.', 'sale', 'house', 9000000, 'Nairobi', 'Nairobi', $4, $5)
       returning id`,
      [`s8m-listing-${slugCounter}`, owner, `S8M listing ${slugCounter}`, status, publishedAt],
    );
  }

  async function listing(id: string) {
    return (
      await client.query<{ status: string; published_at: Date | null; reviewed_by: string | null; rejection_reason: string | null }>(
        `select status, published_at, reviewed_by, rejection_reason from properties where id = $1`,
        [id],
      )
    ).rows[0];
  }

  async function logActions(id: string): Promise<string[]> {
    return (await moderationHistory(db, id)).map((entry) => entry.action);
  }

  it("approves a listing in review when the plan is active, and logs it", async () => {
    const id = await insertListing("s8m_lister");
    expect((await moderationQueue(db)).map((row) => row.id)).toContain(id);
    expect(await approveListing(db, "s8m_admin", id)).toEqual({ ok: true });
    expect(await listing(id)).toMatchObject({ status: "published", reviewed_by: "s8m_admin", rejection_reason: null });
    expect((await listing(id)).published_at).not.toBeNull();
    expect(await logActions(id)).toEqual(["approve"]);
    expect((await moderationQueue(db)).map((row) => row.id)).not.toContain(id);
    // A second decision on the same listing changes nothing and writes no log.
    expect(await approveListing(db, "s8m_admin", id)).toEqual({ ok: false, reason: "conflict" });
    expect(await rejectListing(db, "s8m_admin", id, "Too late to reject this one.")).toEqual({ ok: false, reason: "conflict" });
    expect(await logActions(id)).toEqual(["approve"]);
  });

  it("keeps the first publish date for a listing returning after an edit", async () => {
    const id = await insertListing("s8m_lister", "pending_review", "2026-01-15T10:00:00Z");
    const [row] = await moderationQueue(db);
    expect(row).toMatchObject({ id, everPublished: true });
    await approveListing(db, "s8m_admin", id);
    expect((await listing(id)).published_at?.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("refuses approval when the lister's plan is not active, leaving it in review", async () => {
    const lapsed = await insertListing("s8m_lapsed");
    const noPlan = await insertListing("s8m_buyer");
    expect(await approveListing(db, "s8m_admin", lapsed)).toEqual({ ok: false, reason: "plan_inactive" });
    expect(await approveListing(db, "s8m_admin", noPlan)).toEqual({ ok: false, reason: "plan_inactive" });
    expect((await listing(lapsed)).status).toBe("pending_review");
    expect(await logActions(lapsed)).toEqual([]);
    expect((await getListingForReview(db, lapsed))?.planPhase).toBe("lapsed");
    expect((await getListingForReview(db, noPlan))?.planPhase).toBe("none");
  });

  it("rejects with a reason the lister sees", async () => {
    const id = await insertListing("s8m_lister");
    expect(await rejectListing(db, "s8m_admin", id, "Photos show a different property.")).toEqual({ ok: true });
    expect(await listing(id)).toMatchObject({ status: "rejected", rejection_reason: "Photos show a different property." });
    const [entry] = await moderationHistory(db, id);
    expect(entry).toMatchObject({ action: "reject", reason: "Photos show a different property.", actorName: "s8m_admin" });
  });

  it("returns not_found for unknown and malformed ids", async () => {
    expect(await approveListing(db, "s8m_admin", "00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, reason: "not_found" });
    expect(await rejectListing(db, "s8m_admin", "nope", "A perfectly fine reason.")).toEqual({ ok: false, reason: "not_found" });
    expect(await dismissReport(db, "s8m_admin", "nope")).toEqual({ ok: false, reason: "not_found" });
  });

  it("dismisses a report once", async () => {
    const id = await insertListing("s8m_lister", "published", "2026-10-01T00:00:00Z");
    const reportId = await one(`insert into listing_reports (property_id, reporter_user_id, reason) values ($1, 's8m_buyer', 'scam') returning id`, [id]);
    expect(await dismissReport(db, "s8m_admin", reportId)).toEqual({ ok: true });
    expect(await dismissReport(db, "s8m_admin", reportId)).toEqual({ ok: false, reason: "conflict" });
    const status = (await client.query(`select status, resolved_by from listing_reports where id = $1`, [reportId])).rows[0];
    expect(status).toEqual({ status: "dismissed", resolved_by: "s8m_admin" });
    expect((await listing(id)).status).toBe("published");
    expect(await logActions(id)).toEqual(["dismiss_report"]);
  });

  it("takes a reported listing down, resolving every open report on it", async () => {
    const id = await insertListing("s8m_lister", "published", "2026-10-01T00:00:00Z");
    const first = await one(`insert into listing_reports (property_id, reporter_user_id, reason) values ($1, 's8m_buyer', 'scam') returning id`, [id]);
    const second = await one(`insert into listing_reports (property_id, reporter_user_id, reason) values ($1, 's8m_buyer2', 'duplicate') returning id`, [id]);
    expect(await adminCounts(db)).toMatchObject({ openReports: expect.any(Number) });
    const before = await adminCounts(db);

    expect(await takeDownForReport(db, "s8m_admin", first, "Removed: asks for deposits before viewing.")).toEqual({ ok: true });
    expect(await listing(id)).toMatchObject({ status: "rejected", rejection_reason: "Removed: asks for deposits before viewing." });
    const reports = await client.query(`select id, status from listing_reports where property_id = $1 order by created_at`, [id]);
    expect(reports.rows.map((row) => row.status)).toEqual(["resolved", "resolved"]);
    const [entry] = await moderationHistory(db, id);
    expect(entry).toMatchObject({ action: "take_down" });
    const logRow = (await client.query(`select report_id from listing_moderation_log where property_id = $1`, [id])).rows[0];
    expect(logRow.report_id).toBe(first);

    expect(await takeDownForReport(db, "s8m_admin", second, "Already handled by the first one.")).toEqual({ ok: false, reason: "conflict" });
    const after = await adminCounts(db);
    expect(after.openReports).toBe(before.openReports - 2);
    expect(after.published).toBe(before.published - 1);
  });

  it("keeps the moderation log append-only", async () => {
    const id = await insertListing("s8m_lister");
    await approveListing(db, "s8m_admin", id);
    await client.query("SAVEPOINT log_edit");
    await expect(client.query(`update listing_moderation_log set reason = 'edited' where property_id = $1`, [id])).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT log_edit");
    await client.query("SAVEPOINT log_delete");
    await expect(client.query(`delete from listing_moderation_log where property_id = $1`, [id])).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT log_delete");
  });
});
