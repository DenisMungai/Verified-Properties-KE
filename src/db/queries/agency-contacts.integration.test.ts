import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { getAgencyContactFor, saveAgencyContact } from "./agency-contacts";

/**
 * Agency office contacts (prompt lister-contact-buttons decision 10) against the Neon test branch
 * (TEST_DATABASE_URL). Every test runs in a transaction that is rolled back. Fixture ids are
 * prefixed agc_ so parallel suites never share a unique key.
 */
const url = process.env.TEST_DATABASE_URL;

const OFFICE = { phone: "+254722000111", whatsapp: "+254722000222", email: "office@example.test" };

describe.skipIf(!url)("agency contacts (integration)", { timeout: 120_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  let agencyId: string;
  let otherAgencyId: string;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    agencyId = await one(`insert into agencies (name, slug) values ('AGC Agency', 'agc-agency') returning id`);
    otherAgencyId = await one(`insert into agencies (name, slug) values ('AGC Other', 'agc-other') returning id`);
    await insertUser("agc_admin", agencyId, "admin");
    await insertUser("agc_member", agencyId, "member");
    // Lists for AGC Agency but is an admin only of the other agency.
    await insertUser("agc_cross", agencyId, null);
    await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, 'agc_cross', 'admin')`, [otherAgencyId]);
    await insertUser("agc_solo", null, null);
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function one(statement: string, params: unknown[] = []): Promise<string> {
    return (await client.query<{ id: string }>(statement, params)).rows[0].id;
  }

  async function insertUser(id: string, agency: string | null, role: "admin" | "member" | null) {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name, agency_id) values ($1, $2, $3)`, [id, `Lister ${id}`, agency]);
    if (agency && role) {
      await client.query(`insert into agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [agency, id, role]);
    }
  }

  async function officeRow(id: string) {
    const { rows } = await client.query(`select public_phone, whatsapp, public_email from agencies where id = $1`, [id]);
    return rows[0];
  }

  it("lets an admin of the caller's own agency save its contacts", async () => {
    expect(await saveAgencyContact(db, "agc_admin", OFFICE)).toBe("saved");
    expect(await officeRow(agencyId)).toEqual({ public_phone: OFFICE.phone, whatsapp: OFFICE.whatsapp, public_email: OFFICE.email });
    expect(await getAgencyContactFor(db, "agc_admin")).toEqual({ name: "AGC Agency", ...OFFICE, canEdit: true });
  });

  it("shows a plain member the contacts read-only and refuses their save", async () => {
    await saveAgencyContact(db, "agc_admin", OFFICE);
    expect(await getAgencyContactFor(db, "agc_member")).toMatchObject({ canEdit: false, phone: OFFICE.phone });
    expect(await saveAgencyContact(db, "agc_member", { phone: null, whatsapp: null, email: null })).toBe("not_admin");
    expect(await officeRow(agencyId)).toEqual({ public_phone: OFFICE.phone, whatsapp: OFFICE.whatsapp, public_email: OFFICE.email });
  });

  it("refuses an admin of a different agency, and leaves both agencies unchanged", async () => {
    expect(await saveAgencyContact(db, "agc_cross", OFFICE)).toBe("not_admin");
    expect(await officeRow(agencyId)).toEqual({ public_phone: null, whatsapp: null, public_email: null });
    expect(await officeRow(otherAgencyId)).toEqual({ public_phone: null, whatsapp: null, public_email: null });
  });

  it("has nothing for a lister without an agency", async () => {
    expect(await getAgencyContactFor(db, "agc_solo")).toBeNull();
    expect(await saveAgencyContact(db, "agc_solo", OFFICE)).toBe("no_agency");
  });

  it("rejects a malformed office or WhatsApp number in the database itself", async () => {
    await client.query("SAVEPOINT bad_phone");
    await expect(client.query(`update agencies set whatsapp = '0722000111' where id = $1`, [agencyId])).rejects.toThrow(/agencies_whatsapp_format/);
    await client.query("ROLLBACK TO SAVEPOINT bad_phone");
    await expect(client.query(`update agencies set public_phone = '+25420123456' where id = $1`, [agencyId])).rejects.toThrow(
      /agencies_public_phone_format/,
    );
  });
});
