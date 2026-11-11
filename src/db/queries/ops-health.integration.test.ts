import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { callbacksStalled } from "@/lib/monitoring/rules";
import { pingDatabase, readPushStats } from "./ops-health";

/**
 * The callback-stall read (prompt S21 requirement 3) against the Neon test branch
 * (TEST_DATABASE_URL). Each test runs in a transaction that is rolled back. The clock is fixed in
 * 2001, so pushes the other suites record "now" never fall inside the window.
 */
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2001-02-03T12:00:00Z");
const MINUTE = 60_000;

describe.skipIf(!url)("ops health reads (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let invoiceId: string;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    const plan = await one<{ id: string }>(
      `insert into plans (code, name, kind, price_kes, listing_limit) values ('t_ops_starter', 'Ops', 'listing', 2, 3) returning id`,
    );
    await client.query(`insert into users (id, name, email) values ('t-ops-user', 'Ops', 't-ops-user@ops.test')`);
    const sub = await one<{ id: string }>(
      `insert into subscriptions (owner_user_id, kind, plan_id) values ('t-ops-user', 'listing', $1) returning id`,
      [plan.id],
    );
    invoiceId = (
      await one<{ id: string }>(`insert into invoices (subscription_id, plan_id, amount_kes) values ($1, $2, 2) returning id`, [
        sub.id,
        plan.id,
      ])
    ).id;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
    (await client.query<T>(sql, params)).rows[0];

  /** An STK push `minutesAgo` before NOW, with a callback `callbackAfter` minutes later (or none). */
  async function push(minutesAgo: number, callbackAfter: number | null): Promise<void> {
    const payment = await one<{ id: string }>(
      `insert into payments (invoice_id, method, amount_kes, checkout_request_id) values ($1, 'stk_push', 2, gen_random_uuid()::text) returning id`,
      [invoiceId],
    );
    const at = new Date(NOW.getTime() - minutesAgo * MINUTE);
    await event(payment.id, "stk_push", at);
    if (callbackAfter !== null) await event(payment.id, "stk_callback", new Date(at.getTime() + callbackAfter * MINUTE));
  }

  async function event(paymentId: string, eventType: string, at: Date): Promise<void> {
    await client.query(
      `insert into payment_events (payment_id, invoice_id, event_type, payload, created_at) values ($1, $2, $3, '{}'::jsonb, $4)`,
      [paymentId, invoiceId, eventType, at],
    );
  }

  it("answers the database ping", async () => {
    await expect(pingDatabase(db)).resolves.toBeUndefined();
  });

  it("passes when pushes got their callbacks", async () => {
    await push(30, 1);
    await push(60, 1);
    await push(90, 2);
    const stats = await readPushStats(db, NOW);
    expect(stats).toEqual({ pushes: 3, missing: 0 });
    expect(callbacksStalled(stats)).toBe(false);
  });

  it("fails when 2 of 3 pushes have no callback", async () => {
    await push(30, null);
    await push(60, null);
    await push(90, 1);
    const stats = await readPushStats(db, NOW);
    expect(stats).toEqual({ pushes: 3, missing: 2 });
    expect(callbacksStalled(stats)).toBe(true);
  });

  it("passes with a single push without a callback (under the minimum)", async () => {
    await push(30, null);
    const stats = await readPushStats(db, NOW);
    expect(stats).toEqual({ pushes: 1, missing: 1 });
    expect(callbacksStalled(stats)).toBe(false);
  });

  it("ignores pushes newer than 15 minutes or older than 2 hours", async () => {
    await push(5, null);
    await push(14, null);
    await push(121, null);
    await push(30, 1);
    expect(await readPushStats(db, NOW)).toEqual({ pushes: 1, missing: 0 });
  });
});
