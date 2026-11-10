import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { closeDataRequest, countOpenDataRequests, createDataRequest, listDataRequestsForAdmin, listOwnDataRequests } from "./data-requests";

/**
 * Data requests (prompt S20 decision 7) against the Neon test branch (TEST_DATABASE_URL), in a
 * rolled-back transaction. Fixture ids are prefixed s20_.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("data requests (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    for (const id of ["s20_buyer", "s20_other", "s20_admin"]) {
      await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    }
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("lets a user file requests and list only their own", async () => {
    const first = await createDataRequest(db, "s20_buyer", { kind: "access", details: "Please send me a copy of my data." });
    // One transaction shares now(), so date the first one earlier.
    await client.query(`update data_requests set created_at = now() - interval '1 hour' where id = $1`, [first.id]);
    await createDataRequest(db, "s20_buyer", { kind: "billing", details: "I was charged twice for March." });
    await createDataRequest(db, "s20_other", { kind: "deletion", details: "Please delete my account and data." });

    const own = await listOwnDataRequests(db, "s20_buyer");
    expect(own.map((r) => r.kind)).toEqual(["billing", "access"]);
    expect(own.every((r) => r.status === "open" && r.resolutionNote === null)).toBe(true);
    expect(JSON.stringify(own)).not.toContain("delete my account");
    expect(Object.keys(own[0]).sort()).toEqual(["closedAt", "createdAt", "details", "id", "kind", "resolutionNote", "status"]);
    expect(own.map((r) => r.id)).toContain(first.id);

    expect(await listOwnDataRequests(db, "s20_admin")).toEqual([]);
  });

  it("refuses bad rows at the database too", async () => {
    await expect(createDataRequest(db, "s20_buyer", { kind: "access", details: "too short" })).rejects.toThrow();
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query(`insert into users (id, name, email) values ('s20_buyer', 's20_buyer', 's20_buyer@example.test')`);
    await expect(
      client.query(`insert into data_requests (user_id, kind, details) values ('s20_buyer', 'export', 'A long enough request body.')`),
    ).rejects.toThrow(/data_requests_kind_valid/);
  });

  it("closes once with the admin's note, and a second close changes nothing", async () => {
    const { id } = await createDataRequest(db, "s20_buyer", { kind: "correction", details: "My display name is misspelled." });
    expect(await countOpenDataRequests(db)).toBeGreaterThanOrEqual(1);

    const at = new Date("2026-11-10T10:00:00Z");
    expect(await closeDataRequest(db, "s20_admin", id, "Fixed the spelling.", at)).toEqual({ ok: true });
    expect(await closeDataRequest(db, "s20_admin", id, "A different note.", new Date())).toEqual({ ok: false, reason: "already_closed" });
    expect(await closeDataRequest(db, "s20_admin", "00000000-0000-4000-8000-000000000000", "x")).toEqual({ ok: false, reason: "not_found" });
    expect(await closeDataRequest(db, "s20_admin", "not-a-uuid", "x")).toEqual({ ok: false, reason: "not_found" });

    const [own] = await listOwnDataRequests(db, "s20_buyer");
    expect(own).toMatchObject({ status: "closed", resolutionNote: "Fixed the spelling.", closedAt: at });
    const { rows } = await client.query(`select closed_by from data_requests where id = $1`, [id]);
    expect(rows[0].closed_by).toBe("s20_admin");
  });

  it("lists open requests first, oldest first, with the requester's details for admins", async () => {
    const old = await createDataRequest(db, "s20_buyer", { kind: "access", details: "The older open request." });
    await client.query(`update data_requests set created_at = now() - interval '2 days' where id = $1`, [old.id]);
    const recent = await createDataRequest(db, "s20_other", { kind: "objection", details: "Stop the optional SMS please." });
    const closed = await createDataRequest(db, "s20_other", { kind: "other", details: "A question that is answered." });
    await closeDataRequest(db, "s20_admin", closed.id, "Answered by email.");

    const mine = (await listDataRequestsForAdmin(db)).filter((r) => [old.id, recent.id, closed.id].includes(r.id));
    expect(mine.map((r) => r.id)).toEqual([old.id, recent.id, closed.id]);
    expect(mine[0]).toMatchObject({ userName: "s20_buyer", userEmail: "s20_buyer@example.test" });
  });
});
