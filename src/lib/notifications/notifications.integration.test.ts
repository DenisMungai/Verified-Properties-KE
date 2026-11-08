import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { createInquiry } from "@/db/queries/inquiries";
import { blockUser, markThreadRead, sendMessage } from "@/db/queries/messaging";
import * as schema from "@/db/schema";
import type { EmailMessage } from "@/lib/email/send";
import { runNotifications } from "@/lib/jobs/notifications";
import { runReviewReminders } from "@/lib/jobs/review-reminders";
import { runStorageCleanup } from "@/lib/jobs/storage-cleanup";
import type { JobDeps } from "@/lib/jobs/types";

/**
 * S16 notifications against the Neon test branch (TEST_DATABASE_URL), with a movable clock and a
 * recording (optionally failing) email transport. Every test runs in a transaction that is rolled
 * back. The clock sits in 2031 so nothing else on the branch falls inside the alert window.
 * Fixture ids are prefixed s16n_.
 */
const url = process.env.TEST_DATABASE_URL;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe.skipIf(!url)("notifications (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let clock: Date;
  let emails: EmailMessage[];
  let failEmails: number;
  let deps: JobDeps;
  let listingId: string;
  let conversationId: string;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    for (const id of ["s16n_lister", "s16n_buyer", "s16n_admin", "s16n_admin2"]) {
      await client.query(`insert into users (id, name, email, email_verified) values ($1, $1 || ' Person', $1 || '@example.test', true)`, [id]);
    }
    await client.query(`update users set email_verified = false where id = 's16n_admin2'`);
    await client.query(`insert into user_roles (user_id, role) values ('s16n_admin', 'platform_admin'), ('s16n_admin2', 'platform_admin')`);
    await client.query(`insert into lister_profiles (user_id, display_name) values ('s16n_lister', 'Lister Name')`);
    listingId = (
      await client.query<{ id: string }>(
        `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town, status, published_at)
         values ('s16n-listing', 's16n_lister', 'S16 bedsitter <b>', 'A described listing used by the S16 tests.', 'sale', 'apartment', 4500000,
           'Nairobi', 'Nairobi', 'published', now()) returning id`,
      )
    ).rows[0].id;
    clock = new Date("2031-03-10T08:00:00Z");
    emails = [];
    failEmails = 0;
    deps = {
      db,
      withTransaction: <T,>(fn: (tx: DbExecutor) => Promise<T>) => fn(db),
      now: () => clock,
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
      sms: async () => ({ status: "not_configured" }),
      payments: null,
      card: null,
      storage: null,
    } as unknown as JobDeps;
    const started = await createInquiry(
      db,
      "s16n_buyer",
      listingId,
      { fullName: "Buyer Person", phone: "+254711222333", email: "buyer@example.test", message: "Hello, is this still available?" },
      clock,
    );
    if (!started.ok) throw new Error(`inquiry refused: ${started.reason}`);
    conversationId = started.conversationId;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  function at(ms: number): Date {
    clock = new Date(clock.getTime() + ms);
    return clock;
  }

  const listerEmails = () => emails.filter((e) => e.to === "s16n_lister@example.test");
  const deliveries = async (recipient: string) =>
    (
      await client.query<{ ref: string; status: string; attempts: number; last_error: string | null }>(
        `select ref, status, attempts, last_error from notification_deliveries where kind = 'message_alert' and recipient_user_id = $1 order by created_at`,
        [recipient],
      )
    ).rows;

  /* ---------------------------------------------------------------------- */
  /* Message alerts                                                         */
  /* ---------------------------------------------------------------------- */

  it("waits 5 minutes, sends one alert per unread streak, and alerts again after a read", async () => {
    at(4 * MIN);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(0);
    expect(await deliveries("s16n_lister")).toEqual([]);

    // A second message in the same unread streak.
    expect(await sendMessage(db, "s16n_buyer", conversationId, "Also, is parking included?", at(30_000))).toMatchObject({ ok: true });
    at(2 * MIN);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(1);
    const [alert] = listerEmails();
    expect(alert.subject).toBe("New message about S16 bedsitter <b>");
    expect(alert.text).toContain("you have 2 new messages about S16 bedsitter <b>");
    expect(alert.text).toContain(`https://app.example/account/messages/${conversationId}`);
    expect(alert.text).not.toContain("parking");
    expect(alert.text).not.toContain("Buyer");
    expect(alert.html).not.toContain("<b>");

    // More messages, same streak: nothing more.
    await sendMessage(db, "s16n_buyer", conversationId, "And water?", at(MIN));
    at(10 * MIN);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(1);

    // The lister reads; the next message starts a new streak.
    await markThreadRead(db, "s16n_lister", conversationId, at(MIN));
    await sendMessage(db, "s16n_buyer", conversationId, "Following up on viewing times.", at(MIN));
    at(6 * MIN);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(2);
    expect(listerEmails()[1].text).toContain("you have 1 new message about");
    expect((await deliveries("s16n_lister")).map((d) => d.status)).toEqual(["sent", "sent"]);
  });

  it("never emails someone who read within 5 minutes, and sends each alert once across runs", async () => {
    await markThreadRead(db, "s16n_lister", conversationId, at(2 * MIN));
    at(10 * MIN);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(0);
    expect(await deliveries("s16n_lister")).toEqual([]);

    await sendMessage(db, "s16n_buyer", conversationId, "Any update on this listing?", at(MIN));
    at(6 * MIN);
    await Promise.all([runNotifications(deps), runNotifications(deps)]);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(1);
  });

  it("alerts the buyer about the lister's reply, the same way", async () => {
    await markThreadRead(db, "s16n_lister", conversationId, at(MIN));
    await sendMessage(db, "s16n_lister", conversationId, "Yes, Saturday at 10 works.", at(MIN));
    at(6 * MIN);
    await runNotifications(deps);
    expect(emails.map((e) => e.to)).toEqual(["s16n_buyer@example.test"]);
  });

  it("skips (and records why) when either side has blocked the other", async () => {
    await blockUser(db, "s16n_lister", conversationId);
    at(6 * MIN);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(0);
    expect(await deliveries("s16n_lister")).toMatchObject([{ status: "skipped", last_error: "blocked" }]);
  });

  it("skips a closed conversation and an unverified recipient", async () => {
    await client.query(`update conversations set closed_at = $2 where id = $1`, [conversationId, clock]);
    at(6 * MIN);
    await runNotifications(deps);
    expect(await deliveries("s16n_lister")).toMatchObject([{ status: "skipped", last_error: "conversation_closed" }]);

    await client.query(`update conversations set closed_at = null where id = $1`, [conversationId]);
    await client.query(`update users set email_verified = false where id = 's16n_lister'`);
    await markThreadRead(db, "s16n_lister", conversationId, at(MIN));
    await sendMessage(db, "s16n_buyer", conversationId, "Are you still there?", at(MIN));
    at(6 * MIN);
    await runNotifications(deps);
    expect((await deliveries("s16n_lister")).map((d) => d.last_error)).toEqual(["conversation_closed", "email_unverified"]);
    expect(listerEmails()).toHaveLength(0);
  });

  it("never alerts about unread messages older than 24 hours", async () => {
    at(25 * HOUR);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(0);
    expect(await deliveries("s16n_lister")).toEqual([]);
  });

  it("retries a failed alert after 10 then 20 minutes, then gives up", async () => {
    failEmails = 3;
    at(6 * MIN);
    await runNotifications(deps);
    expect(await deliveries("s16n_lister")).toMatchObject([{ status: "failed", attempts: 1, last_error: "ResendDown" }]);

    at(5 * MIN);
    await runNotifications(deps);
    expect(await deliveries("s16n_lister")).toMatchObject([{ status: "failed", attempts: 1 }]);

    at(6 * MIN); // 11 minutes after the failure
    await runNotifications(deps);
    expect(await deliveries("s16n_lister")).toMatchObject([{ status: "failed", attempts: 2 }]);

    at(21 * MIN);
    await runNotifications(deps);
    expect(await deliveries("s16n_lister")).toMatchObject([{ status: "failed", attempts: 3 }]);

    at(2 * HOUR);
    const result = await runNotifications(deps);
    expect(result.counts.retriesDue ?? 0).toBe(0);
    expect(listerEmails()).toHaveLength(0);
  });

  it("finishes a retry as skipped when the recipient has read the thread since", async () => {
    failEmails = 1;
    at(6 * MIN);
    await runNotifications(deps);
    await markThreadRead(db, "s16n_lister", conversationId, at(MIN));
    at(11 * MIN);
    await runNotifications(deps);
    expect(await deliveries("s16n_lister")).toMatchObject([{ status: "skipped", attempts: 2, last_error: "read" }]);
    expect(listerEmails()).toHaveLength(0);
  });

  it("reclaims an alert abandoned mid-send after 15 minutes", async () => {
    const [{ id: messageId }] = (
      await client.query<{ id: string }>(`select id from messages where conversation_id = $1`, [conversationId])
    ).rows;
    await client.query(
      `insert into notification_deliveries (kind, ref, recipient_user_id, status, created_at, updated_at) values ('message_alert', $1, 's16n_lister', 'pending', $2, $2)`,
      [messageId, new Date(clock.getTime() + 6 * MIN)],
    );
    at(10 * MIN);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(0);
    at(15 * MIN);
    await runNotifications(deps);
    expect(listerEmails()).toHaveLength(1);
    expect(await deliveries("s16n_lister")).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  /* ---------------------------------------------------------------------- */
  /* Review digest                                                          */
  /* ---------------------------------------------------------------------- */

  it("sends one review digest a day to verified platform admins when a listing waits over 24 hours", async () => {
    await client.query(`update properties set status = 'pending_review', published_at = null, updated_at = $2 where id = $1`, [
      listingId,
      new Date(clock.getTime() - 25 * HOUR),
    ]);
    // Something else may be overdue on the shared branch; only our recipients are asserted.
    const first = await runReviewReminders(deps);
    expect(first.counts.listingsOverdue).toBeGreaterThanOrEqual(1);
    const digests = emails.filter((e) => e.to.startsWith("s16n_admin"));
    expect(digests.map((e) => e.to)).toEqual(["s16n_admin@example.test"]);
    expect(digests[0].text).toContain("Listings waiting over 24 hours:");
    expect(digests[0].text).toContain("https://app.example/admin/listings");

    at(3 * HOUR);
    await runReviewReminders(deps);
    expect(emails.filter((e) => e.to.startsWith("s16n_admin"))).toHaveLength(1);

    at(DAY);
    await runReviewReminders(deps);
    expect(emails.filter((e) => e.to.startsWith("s16n_admin"))).toHaveLength(2);
  });

  it("sends no digest when nothing has waited 24 hours", async () => {
    await client.query(`update properties set status = 'pending_review', published_at = null, updated_at = $2 where id = $1`, [
      listingId,
      new Date(clock.getTime() - 2 * HOUR),
    ]);
    const before = new Date(clock.getTime() - 24 * HOUR);
    const others = await client.query<{ n: number }>(
      `select (select count(*) from properties where status = 'pending_review' and updated_at <= $1)
            + (select count(*) from verification_requests where status = 'under_review' and submitted_at <= $1) as n`,
      [before],
    );
    const result = await runReviewReminders(deps);
    if (Number(others.rows[0].n) === 0) {
      expect(result).toMatchObject({ status: "skipped", counts: { nothingOverdue: 1 } });
      expect(emails).toHaveLength(0);
    } else {
      // Someone else's overdue item on the shared branch: ours must not be counted.
      expect(result.counts.listingsOverdue ?? 0).toBeLessThanOrEqual(Number(others.rows[0].n));
    }
  });

  /* ---------------------------------------------------------------------- */
  /* Cleanup                                                                */
  /* ---------------------------------------------------------------------- */

  it("prunes old job runs and deliveries even without storage", async () => {
    const old = new Date(clock.getTime() - 100 * DAY);
    await client.query(`insert into job_runs (job, status, started_at) values ('s16n-old', 'ok', $1), ('s16n-new', 'ok', $2)`, [old, clock]);
    await client.query(
      `insert into notification_deliveries (kind, ref, recipient_user_id, status, created_at, updated_at)
       values ('review_digest', '2030-01-01', 's16n_admin', 'sent', $1, $1), ('review_digest', '2031-03-10', 's16n_admin', 'sent', $2, $2)`,
      [old, clock],
    );
    const result = await runStorageCleanup(deps);
    expect(result).toMatchObject({ status: "ok", counts: { storageNotConfigured: 1 } });
    expect(result.counts.jobRunsPruned).toBeGreaterThanOrEqual(1);
    const runs = await client.query(`select job from job_runs where job like 's16n-%'`);
    expect(runs.rows.map((r) => r.job)).toEqual(["s16n-new"]);
    const kept = await client.query(`select ref from notification_deliveries where recipient_user_id = 's16n_admin'`);
    expect(kept.rows.map((r) => r.ref)).toEqual(["2031-03-10"]);
  });
});
