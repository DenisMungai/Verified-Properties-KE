import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";

/**
 * Checks the database-level rules in drizzle/0001_core_schema.sql against a migrated database.
 * Needs TEST_DATABASE_URL (a Neon test branch, or the Postgres service in CI); skipped otherwise.
 * Every test runs inside a transaction that is rolled back, so it leaves no data behind.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("core schema constraints", () => {
  const client = new Client({ connectionString: url });

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    await client.query(
      `insert into users (id, name, email) values ('u_test', 'Test Lister', 'lister@example.test')`,
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function insertProperty(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      slug: `test-${Math.random().toString(36).slice(2)}`,
      owner_user_id: "u_test",
      title: "Two bedroom apartment",
      description: "Test listing",
      listing_type: "sale",
      category: "apartment",
      price_kes: 8_500_000,
      rent_period: null,
      county: "Nairobi",
      town: "Kilimani",
      ...overrides,
    };
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const result = await client.query<{ id: string }>(
      `insert into properties (${columns.join(", ")}) values (${placeholders}) returning id`,
      values,
    );
    return result.rows[0].id;
  }

  /** Runs a statement that must fail, without aborting the surrounding transaction. */
  async function expectRejected(statement: string, params: unknown[] = []): Promise<void> {
    await client.query("SAVEPOINT expect_rejected");
    await expect(client.query(statement, params)).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT expect_rejected");
  }

  it("has the v2.0 listing statuses, roles and verification statuses", async () => {
    const statuses = await client.query<{ v: string }>(
      "select unnest(enum_range(null::listing_status))::text as v",
    );
    expect(statuses.rows.map((r) => r.v)).toContain("paused");

    const roles = await client.query<{ v: string }>("select unnest(enum_range(null::app_role))::text as v");
    expect(roles.rows.map((r) => r.v)).toContain("billing_admin");

    const verification = await client.query<{ v: string }>(
      "select unnest(enum_range(null::verification_status))::text as v",
    );
    expect(verification.rows.map((r) => r.v)).toEqual([
      "unverified",
      "payment_pending",
      "under_review",
      "verified",
      "rejected",
      "expired",
      "suspended",
    ]);
  });

  it("stores price as whole shillings and rejects negatives", async () => {
    const id = await insertProperty();
    const price = await client.query<{ type: string }>(
      "select pg_typeof(price_kes)::text as type from properties where id = $1",
      [id],
    );
    expect(price.rows[0].type).toBe("bigint");
    await expectRejected(
      `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town)
       values ('neg', 'u_test', 't', 'd', 'sale', 'house', -1, 'Nairobi', 'Karen')`,
    );
  });

  it("requires a rent period on rent listings only", async () => {
    await insertProperty({ listing_type: "rent", rent_period: "month", price_kes: 85_000 });
    await expectRejected(
      `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town, rent_period)
       values ('sale-with-period', 'u_test', 't', 'd', 'sale', 'house', 1, 'Nairobi', 'Karen', 'month')`,
    );
    await expectRejected(
      `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town)
       values ('rent-no-period', 'u_test', 't', 'd', 'rent', 'house', 1, 'Nairobi', 'Karen')`,
    );
  });

  it("rejects out-of-range coordinates", async () => {
    const id = await insertProperty();
    await expectRejected("update properties set exact_latitude = 91 where id = $1", [id]);
  });

  it("keeps the moderation log append-only", async () => {
    const propertyId = await insertProperty();
    const log = await client.query<{ id: string }>(
      `insert into listing_moderation_log (property_id, actor_user_id, action)
       values ($1, 'u_test', 'approved') returning id`,
      [propertyId],
    );
    const logId = log.rows[0].id;
    await expectRejected("update listing_moderation_log set action = 'rejected' where id = $1", [logId]);
    await expectRejected("delete from listing_moderation_log where id = $1", [logId]);
  });

  it("keeps the verification audit log append-only", async () => {
    const request = await client.query<{ id: string }>(
      `insert into verification_requests (lister_user_id) values ('u_test') returning id`,
    );
    const log = await client.query<{ id: string }>(
      `insert into verification_audit_log (request_id, actor_user_id, action)
       values ($1, 'u_test', 'submitted') returning id`,
      [request.rows[0].id],
    );
    await expectRejected("update verification_audit_log set action = 'approved' where id = $1", [
      log.rows[0].id,
    ]);
  });

  it("cannot mark a review verified without a decision and expiry", async () => {
    await expectRejected(
      `insert into verification_requests (lister_user_id, status) values ('u_test', 'verified')`,
    );
  });

  it("allows only one cover image per listing", async () => {
    const id = await insertProperty();
    await client.query(
      `insert into property_images (property_id, storage_key, alt_text, is_cover) values ($1, 'a.webp', 'Front', true)`,
      [id],
    );
    await expectRejected(
      `insert into property_images (property_id, storage_key, alt_text, is_cover) values ($1, 'b.webp', 'Back', true)`,
      [id],
    );
  });
});
