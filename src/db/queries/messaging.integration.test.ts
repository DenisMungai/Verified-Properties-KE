import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { createInquiry } from "./inquiries";
import {
  dismissMessageReport,
  getReportedThread,
  listOpenMessageReports,
  removeReportedMessage,
  reportMessage,
} from "./message-moderation";
import {
  blockUser,
  buyerContactFor,
  conversationForListing,
  getThread,
  listConversations,
  markThreadRead,
  messageStatus,
  sendMessage,
  unblockUser,
  unreadTotal,
} from "./messaging";

/**
 * In-app messaging (prompt S15) against the Neon test branch (TEST_DATABASE_URL). Every test runs
 * in a transaction that is rolled back. Fixture ids are prefixed s15m_ so parallel suites never
 * share a unique key.
 *
 * Covers the Phase 2 exit check "cross-user access to conversations is shown to be blocked":
 * a third user can't read, mark, poll, send, block or report in someone else's conversation.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("messaging (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let listingId: string;
  let conversationId: string;
  let clock = new Date("2026-11-08T08:00:00Z");

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    for (const id of ["s15m_lister", "s15m_buyer", "s15m_other", "s15m_admin"]) {
      await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    }
    await client.query(`insert into lister_profiles (user_id, display_name, phone) values ('s15m_lister', 'Lister Name', '+254712000999')`);
    listingId = (
      await client.query<{ id: string }>(
        `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town, status, published_at)
         values ('s15m-listing', 's15m_lister', 'S15 flat', 'A described listing used by the S15 tests.', 'sale', 'apartment', 5000000,
           'Nairobi', 'Nairobi', 'published', now()) returning id`,
      )
    ).rows[0].id;
    clock = new Date("2026-11-08T08:00:00Z");
    const started = await createInquiry(db, "s15m_buyer", listingId, inquiry(), clock);
    if (!started.ok) throw new Error(`inquiry refused: ${started.reason}`);
    conversationId = started.conversationId;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  function inquiry(message = "Hello, is this still available for viewing?") {
    return { fullName: "Buyer Person", phone: "+254711222333", email: "buyer@example.test", message };
  }

  function tick(seconds = 120): Date {
    clock = new Date(clock.getTime() + seconds * 1000);
    return clock;
  }

  /* ---------------------------------------------------------------------- */
  /* Conversations                                                          */
  /* ---------------------------------------------------------------------- */

  it("starts the conversation from the inquiry and lets both participants exchange messages", async () => {
    expect(await conversationForListing(db, "s15m_buyer", listingId)).toBe(conversationId);
    expect(await unreadTotal(db, "s15m_lister")).toBe(1);

    expect(await sendMessage(db, "s15m_lister", conversationId, "Yes, Saturday at 10 works.", tick())).toMatchObject({ ok: true });
    expect(await unreadTotal(db, "s15m_buyer")).toBe(1);

    const thread = await getThread(db, "s15m_buyer", conversationId);
    expect(thread).toMatchObject({ role: "buyer", otherName: "Lister Name", propertyTitle: "S15 flat", closed: false });
    expect(thread!.messages.map((m) => [m.mine, m.body])).toEqual([
      [true, "Hello, is this still available for viewing?"],
      [false, "Yes, Saturday at 10 works."],
    ]);

    expect(await markThreadRead(db, "s15m_buyer", conversationId)).toBe(1);
    expect(await unreadTotal(db, "s15m_buyer")).toBe(0);
    // The buyer's own unread message to the lister is untouched by the buyer reading.
    expect(await unreadTotal(db, "s15m_lister")).toBe(1);

    const status = await messageStatus(db, "s15m_buyer", conversationId);
    expect(status.lastMessageAt).toBe(clock.toISOString());
    expect(await buyerContactFor(db, "s15m_buyer", listingId)).toEqual({ phone: "+254711222333", email: "buyer@example.test" });
  });

  it("blocks every kind of cross-user access to a conversation", async () => {
    expect(await getThread(db, "s15m_other", conversationId)).toBeNull();
    expect(await listConversations(db, "s15m_other")).toEqual([]);
    expect(await markThreadRead(db, "s15m_other", conversationId)).toBe(0);
    expect(await unreadTotal(db, "s15m_lister")).toBe(1);
    expect(await messageStatus(db, "s15m_other", conversationId)).toEqual({ unread: 0 });
    expect(await sendMessage(db, "s15m_other", conversationId, "Let me in", tick())).toEqual({ ok: false, reason: "not_found" });
    expect(await blockUser(db, "s15m_other", conversationId)).toEqual({ ok: false, reason: "not_found" });

    const [message] = (await getThread(db, "s15m_lister", conversationId))!.messages;
    expect(await reportMessage(db, "s15m_other", message.id, { reason: "spam", details: null, block: true })).toEqual({ ok: false, reason: "not_found" });

    const count = await client.query(`select count(*)::int n from messages where conversation_id = $1`, [conversationId]);
    expect(count.rows[0].n).toBe(1);
    // Odd ids behave like missing ones.
    expect(await getThread(db, "s15m_buyer", "not-a-uuid")).toBeNull();
  });

  it("refuses a double send within a minute, but not a repeat later", async () => {
    const at = tick();
    expect(await sendMessage(db, "s15m_buyer", conversationId, "Is parking included?", at)).toMatchObject({ ok: true });
    expect(await sendMessage(db, "s15m_buyer", conversationId, "Is parking included?", new Date(at.getTime() + 5_000))).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(await sendMessage(db, "s15m_buyer", conversationId, "Is parking included?", tick(90))).toMatchObject({ ok: true });
  });

  /* ---------------------------------------------------------------------- */
  /* Blocking                                                               */
  /* ---------------------------------------------------------------------- */

  it("stops sending both ways and new inquiries after a block, until unblocked", async () => {
    expect(await blockUser(db, "s15m_lister", conversationId)).toEqual({ ok: true });
    expect(await getThread(db, "s15m_lister", conversationId)).toMatchObject({ blockedByMe: true, blockedByOther: false });
    expect(await getThread(db, "s15m_buyer", conversationId)).toMatchObject({ blockedByMe: false, blockedByOther: true });

    expect(await sendMessage(db, "s15m_lister", conversationId, "Hello?", tick())).toEqual({ ok: false, reason: "blocked" });
    expect(await sendMessage(db, "s15m_buyer", conversationId, "Hello?", tick())).toEqual({ ok: false, reason: "blocked" });
    expect(await createInquiry(db, "s15m_buyer", listingId, inquiry("Another try about the flat."), tick())).toEqual({ ok: false, reason: "blocked" });

    // Only the blocker can lift it.
    expect(await unblockUser(db, "s15m_buyer", conversationId)).toEqual({ ok: true });
    expect(await sendMessage(db, "s15m_buyer", conversationId, "Hello?", tick())).toEqual({ ok: false, reason: "blocked" });
    expect(await unblockUser(db, "s15m_lister", conversationId)).toEqual({ ok: true });
    expect(await sendMessage(db, "s15m_buyer", conversationId, "Hello again?", tick())).toMatchObject({ ok: true });
  });

  /* ---------------------------------------------------------------------- */
  /* Reports and moderation                                                 */
  /* ---------------------------------------------------------------------- */

  async function reportBuyersMessage(block = true) {
    const [message] = (await getThread(db, "s15m_lister", conversationId))!.messages;
    expect(await reportMessage(db, "s15m_lister", message.id, { reason: "scam", details: "Asked for a deposit.", block })).toEqual({ ok: true });
    const [report] = await listOpenMessageReports(db);
    return { messageId: message.id, reportId: report.id };
  }

  it("lets only the recipient report, once, optionally blocking the sender", async () => {
    const [message] = (await getThread(db, "s15m_buyer", conversationId))!.messages;
    // Your own message can't be reported.
    expect(await reportMessage(db, "s15m_buyer", message.id, { reason: "spam", details: null, block: false })).toEqual({ ok: false, reason: "not_found" });

    await reportBuyersMessage();
    expect(await reportMessage(db, "s15m_lister", message.id, { reason: "spam", details: null, block: false })).toEqual({
      ok: false,
      reason: "already_reported",
    });
    expect((await getThread(db, "s15m_lister", conversationId))!.messages[0].reportedByMe).toBe(true);
    expect(await sendMessage(db, "s15m_buyer", conversationId, "Why?", tick())).toEqual({ ok: false, reason: "blocked" });
    expect(await listOpenMessageReports(db)).toMatchObject([{ reason: "scam", reporterName: "s15m_lister", excerpt: message.body }]);
  });

  it("logs moderator views, removes messages and closes conversations, append-only", async () => {
    const { messageId, reportId } = await reportBuyersMessage(false);

    const viewed = await getReportedThread(db, "s15m_admin", reportId);
    expect(viewed?.messages.map((m) => m.id)).toEqual([messageId]);
    expect(await getReportedThread(db, "s15m_admin", "00000000-0000-4000-8000-000000000000")).toBeNull();

    expect(await removeReportedMessage(db, "s15m_admin", reportId, "Asked for a deposit before viewing.", true)).toEqual({ ok: true });
    expect(await removeReportedMessage(db, "s15m_admin", reportId, "Asked for a deposit before viewing.", true)).toEqual({ ok: false, reason: "conflict" });

    const thread = await getThread(db, "s15m_buyer", conversationId);
    expect(thread).toMatchObject({ closed: true });
    expect(thread!.messages[0].body).toBeNull();
    expect(await sendMessage(db, "s15m_lister", conversationId, "Sorry", tick())).toEqual({ ok: false, reason: "closed" });
    expect(await createInquiry(db, "s15m_buyer", listingId, inquiry("Trying the form again now."), tick())).toEqual({ ok: false, reason: "closed" });
    expect(await listConversations(db, "s15m_lister")).toMatchObject([{ lastExcerpt: null, closed: true }]);
    expect(await unreadTotal(db, "s15m_lister")).toBe(0);

    const log = await client.query(`select action from message_moderation_log where conversation_id = $1 order by created_at, action`, [conversationId]);
    expect(log.rows.map((row) => row.action).sort()).toEqual(["close_conversation", "remove_message", "view_conversation"]);

    await client.query("SAVEPOINT log_change");
    await expect(client.query(`update message_moderation_log set reason = 'changed' where conversation_id = $1`, [conversationId])).rejects.toThrow(
      /append-only/,
    );
    await client.query("ROLLBACK TO SAVEPOINT log_change");
    await expect(client.query(`delete from message_moderation_log where conversation_id = $1`, [conversationId])).rejects.toThrow(/append-only/);
  });

  /* ---------------------------------------------------------------------- */
  /* Migration 0009 backfill                                                */
  /* ---------------------------------------------------------------------- */

  it("backfills old inquiries into conversations once, keeping time and read state", async () => {
    const sqlText = readFileSync(join(process.cwd(), "drizzle", "0009_messaging.sql"), "utf8");
    const backfill = sqlText
      .slice(sqlText.indexOf("-- Backfill"))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(backfill).toHaveLength(3);

    // An S8-era inquiry with no conversation yet, already read by the lister.
    await client.query(`insert into users (id, name, email) values ('s15m_old', 's15m_old', 's15m_old@example.test')`);
    await client.query(
      `insert into inquiries (property_id, sender_user_id, recipient_user_id, full_name, phone, message, created_at, read_at)
       values ($1, 's15m_old', 's15m_lister', 'Old Buyer', '+254700000001', 'An inquiry from before S15.', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z')`,
      [listingId],
    );
    for (let run = 0; run < 2; run++) for (const statement of backfill) await client.query(statement);

    const rows = await client.query(
      `select m.body, m.created_at, m.read_at, c.last_message_at from messages m join conversations c on c.id = m.conversation_id
       where c.buyer_user_id = 's15m_old'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].body).toBe("An inquiry from before S15.");
    expect(rows.rows[0].read_at.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(rows.rows[0].last_message_at.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    // The conversation started by createInquiry already had its message: nothing duplicated.
    const existing = await client.query(`select count(*)::int n from messages where conversation_id = $1`, [conversationId]);
    expect(existing.rows[0].n).toBe(1);
  });

  it("dismisses a report without touching the message", async () => {
    const { reportId } = await reportBuyersMessage(false);
    expect(await dismissMessageReport(db, "s15m_admin", reportId)).toEqual({ ok: true });
    expect(await listOpenMessageReports(db)).toEqual([]);
    expect((await getThread(db, "s15m_lister", conversationId))!.messages[0].body).toBe("Hello, is this still available for viewing?");
  });
});
