import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { hashInviteToken } from "@/lib/agencies/invite-token";
import { createAgency, getMembership, leaveAgency, listMembers, previewJoin, removeMember, setAgencyLogo, setMemberRole, updateAgencyDetails } from "./agencies";
import { acceptInvite, createInvite, declineInvite, getInvite, listAgencyInvites, openInvitesFor, pruneAgencyInvites, revokeInvite } from "./agency-invites";
import { getPublicAgency, getPublicTeam, listAgencyDirectory } from "./public-agencies";

/**
 * Agencies (prompt S23) against the Neon test branch (TEST_DATABASE_URL). Every test runs in a
 * transaction that is rolled back. Fixture ids and slugs are prefixed s23 so parallel suites never
 * share a unique key.
 */
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!url)("agencies (integration)", { timeout: 180_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;
  const now = new Date();

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    await insertPlan("s23_personal", "Personal", 10, false);
    await insertPlan("s23_agency", "Agency", 3, true);
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  /* ---------------------------------------------------------------------- */
  /* Fixtures                                                               */
  /* ---------------------------------------------------------------------- */

  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
    (await client.query<T>(sql, params)).rows[0];
  const all = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query<T>(sql, params)).rows;

  async function insertPlan(code: string, name: string, limit: number, agency: boolean) {
    await client.query(
      `insert into plans (code, name, kind, price_kes, listing_limit, is_agency_plan) values ($1, $2, 'listing', 1000, $3, $4)`,
      [code, name, limit, agency],
    );
  }

  async function lister(id: string, opts: { profile?: boolean } = {}) {
    await client.query(`insert into users (id, name, email, email_verified) values ($1, $1, $1 || '@s23.test', true)`, [id]);
    if (opts.profile !== false) {
      await client.query(`insert into lister_profiles (user_id, display_name) values ($1, $2)`, [id, `Lister ${id}`]);
      await client.query(`insert into user_roles (user_id, role) values ($1, 'agent')`, [id]);
    }
    return { id, email: `${id}@s23.test`, emailVerified: true };
  }

  async function listing(ownerId: string, status: string, daysAgo: number) {
    const r = await one<{ id: string }>(
      `insert into properties (slug, owner_user_id, title, description, listing_type, category, price_kes, county, town, status, published_at)
       values ('s23-' || gen_random_uuid()::text, $1, 'S23 home', 'A test listing', 'sale', 'house', 1000000, 'Nairobi', 'Nairobi', $2::listing_status,
         case when $2::text in ('published', 'archived') then now() - make_interval(days => $3::int) end)
       returning id`,
      [ownerId, status, daysAgo],
    );
    return r.id;
  }

  /** An active, paid listing subscription for a user or an agency, with an open renewal invoice. */
  async function activePlan(owner: { userId?: string; agencyId?: string }, code: string) {
    const plan = await one<{ id: string }>(`select id from plans where code = $1`, [code]);
    const sub = await one<{ id: string }>(
      `insert into subscriptions (owner_user_id, owner_agency_id, kind, plan_id, status, current_period_start, current_period_end, grace_ends_at)
       values ($1, $2, 'listing', $3, 'active', now() - interval '5 days', now() + interval '25 days', now() + interval '28 days')
       returning id`,
      [owner.userId ?? null, owner.agencyId ?? null, plan.id],
    );
    const invoice = await one<{ id: string }>(`insert into invoices (subscription_id, plan_id, amount_kes) values ($1, $2, 1000) returning id`, [sub.id, plan.id]);
    return { subscriptionId: sub.id, invoiceId: invoice.id };
  }

  const statusOf = async (id: string) => (await one<{ status: string; pause_reason: string | null }>(`select status, pause_reason from properties where id = $1`, [id]));
  const agencyOfListing = async (id: string) => (await one<{ agency_id: string | null }>(`select agency_id from properties where id = $1`, [id])).agency_id;
  const roles = async (userId: string) => (await all<{ role: string }>(`select role from user_roles where user_id = $1 order by role`, [userId])).map((r) => r.role);

  async function makeAgency(adminId: string, name = "S23 Realty") {
    const result = await createAgency(db, adminId, { name, description: "Test agency" }, now);
    if (!result.ok) throw new Error(result.reason);
    return result;
  }

  async function invite(adminId: string, email: string, role: "admin" | "member" = "member") {
    const created = await createInvite(db, adminId, { email, role }, now);
    if (!created.ok) throw new Error(created.reason);
    return created.token;
  }

  const byToken = (token: string) => ({ kind: "hash" as const, hash: hashInviteToken(token) });

  /* ---------------------------------------------------------------------- */
  /* Creating                                                               */
  /* ---------------------------------------------------------------------- */

  it("creates an agency: the creator is its admin, listings move in, own plan cancelled and audited", async () => {
    const ann = await lister("s23_ann");
    const live = await listing(ann.id, "published", 2);
    const draft = await listing(ann.id, "draft", 0);
    const archived = await listing(ann.id, "archived", 40);
    const { subscriptionId, invoiceId } = await activePlan({ userId: ann.id }, "s23_personal");

    const created = await makeAgency(ann.id, "S23 Realty & Sons");
    expect(created.slug).toBe("s23-realty-sons");

    const membership = await getMembership(db, ann.id);
    expect(membership).toMatchObject({ name: "S23 Realty & Sons", role: "admin" });
    expect(await roles(ann.id)).toContain("agency_admin");
    expect(await agencyOfListing(live)).toBe(created.agencyId);
    expect(await agencyOfListing(draft)).toBe(created.agencyId);
    expect(await agencyOfListing(archived)).toBeNull();

    // A new agency has no plan: the live listing is paused for the limit.
    expect(await statusOf(live)).toEqual({ status: "paused", pause_reason: "over_plan_limit" });
    expect((await one<{ status: string }>(`select status from subscriptions where id = $1`, [subscriptionId])).status).toBe("cancelled");
    expect((await one<{ status: string }>(`select status from invoices where id = $1`, [invoiceId])).status).toBe("void");
    const audit = await one<{ action: string; actor_user_id: string; reason: string }>(
      `select action, actor_user_id, reason from billing_audit_log where subscription_id = $1`,
      [subscriptionId],
    );
    expect(audit).toEqual({ action: "agency_join_plan_cancelled", actor_user_id: ann.id, reason: "Joined agency S23 Realty & Sons" });
    const events = await all(`select 1 from payment_events where payload->>'reason' = 'agency_join' and (invoice_id = $1 or payload->>'subscriptionId' = $2)`, [
      invoiceId,
      subscriptionId,
    ]);
    expect(events).toHaveLength(2);
  });

  it("gives a second agency with the same name a numbered slug, and refuses a lister already in one", async () => {
    const a = await lister("s23_a");
    const b = await lister("s23_b");
    expect((await makeAgency(a.id, "S23 Same")).slug).toBe("s23-same");
    expect((await makeAgency(b.id, "S23 Same")).slug).toBe("s23-same-2");
    expect(await createAgency(db, a.id, { name: "S23 Other", description: null }, now)).toEqual({ ok: false, reason: "already_in_agency" });
  });

  it("needs a lister profile", async () => {
    const buyer = await lister("s23_buyer", { profile: false });
    expect(await createAgency(db, buyer.id, { name: "S23 Nope", description: null }, now)).toEqual({ ok: false, reason: "no_profile" });
  });

  /* ---------------------------------------------------------------------- */
  /* Invites                                                                */
  /* ---------------------------------------------------------------------- */

  it("lets an agent accept an invite for their own email; listings fill the agency's free places", async () => {
    const admin = await lister("s23_admin");
    const agency = await makeAgency(admin.id);
    await activePlan({ agencyId: agency.agencyId }, "s23_agency"); // 3 places, none used
    const bob = await lister("s23_bob");
    const newest = await listing(bob.id, "published", 1);
    const middle = await listing(bob.id, "published", 5);
    const middle2 = await listing(bob.id, "published", 7);
    const oldest = await listing(bob.id, "published", 9);
    const review = await listing(bob.id, "pending_review", 0);
    await activePlan({ userId: bob.id }, "s23_personal");

    const token = await invite(admin.id, bob.email);
    const preview = await previewJoin(db, bob.id, agency.agencyId, now);
    expect(preview.freeSlots).toBe(3);
    expect(preview.pauseIds).toEqual([oldest]);
    expect(preview.toDraftIds).toEqual([review]);

    const accepted = await acceptInvite(db, bob, byToken(token), now);
    expect(accepted.ok).toBe(true);
    for (const id of [newest, middle, middle2]) expect((await statusOf(id)).status).toBe("published");
    expect(await statusOf(oldest)).toEqual({ status: "paused", pause_reason: "over_plan_limit" });
    expect((await statusOf(review)).status).toBe("draft");
    expect((await getMembership(db, bob.id))?.role).toBe("member");
    expect(await roles(bob.id)).not.toContain("agency_admin");
    expect((await getInvite(db, byToken(token), now))?.state).toBe("accepted");

    // A used link does nothing more.
    expect(await acceptInvite(db, bob, byToken(token), now)).toEqual({ ok: false, reason: "accepted" });
  });

  it("refuses the wrong account, expired and revoked invites, and changes nothing", async () => {
    const admin = await lister("s23_admin2");
    await makeAgency(admin.id);
    const carol = await lister("s23_carol");
    const mallory = await lister("s23_mallory");
    const token = await invite(admin.id, carol.email);

    expect(await acceptInvite(db, mallory, byToken(token), now)).toEqual({ ok: false, reason: "wrong_email" });
    expect(await getMembership(db, mallory.id)).toBeNull();
    expect(await acceptInvite(db, carol, byToken(token), new Date(now.getTime() + 8 * DAY))).toEqual({ ok: false, reason: "expired" });

    const [row] = await listAgencyInvites(db, (await getMembership(db, admin.id))!.agencyId, now);
    expect(await revokeInvite(db, admin.id, row!.id, now)).toBe("revoked");
    expect(await acceptInvite(db, carol, byToken(token), now)).toEqual({ ok: false, reason: "revoked" });
    expect(await getMembership(db, carol.id)).toBeNull();
    expect(await acceptInvite(db, carol, byToken("x".repeat(43)), now)).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses an unverified email even when it matches the invite (prompt S24 decision 8)", async () => {
    const admin = await lister("s23_admin_unv");
    await makeAgency(admin.id);
    const kim = await lister("s23_kim");
    const token = await invite(admin.id, kim.email);
    const unverified = { ...kim, emailVerified: false };
    expect(await acceptInvite(db, unverified, byToken(token), now)).toEqual({ ok: false, reason: "wrong_email" });
    expect(await declineInvite(db, unverified, byToken(token), now)).toEqual({ ok: false, reason: "wrong_email" });
    expect(await openInvitesFor(db, unverified, now)).toEqual([]);
    expect((await openInvitesFor(db, kim, now)).map((i) => i.agencyName)).toEqual(["S23 Realty"]);
    expect((await getInvite(db, byToken(token), now))?.state).toBe("open");
  });

  it("re-inviting replaces the old link; declining closes it", async () => {
    const admin = await lister("s23_admin3");
    await makeAgency(admin.id);
    const dan = await lister("s23_dan");
    const first = await invite(admin.id, dan.email);
    const second = await invite(admin.id, dan.email.toUpperCase());
    expect((await getInvite(db, byToken(first), now))?.state).toBe("revoked");
    expect(await declineInvite(db, dan, byToken(second), now)).toEqual({ ok: true });
    expect((await getInvite(db, byToken(second), now))?.state).toBe("declined");
  });

  it("only an agency's admins invite, and never an existing member", async () => {
    const admin = await lister("s23_admin4");
    await makeAgency(admin.id);
    const member = await lister("s23_member4");
    await acceptInvite(db, member, byToken(await invite(admin.id, member.email)), now);
    const outsider = await lister("s23_outsider");
    const otherAdmin = await lister("s23_other_admin");
    await makeAgency(otherAdmin.id, "S23 Elsewhere");

    expect(await createInvite(db, member.id, { email: "x@s23.test", role: "member" }, now)).toEqual({ ok: false, reason: "not_admin" });
    expect(await createInvite(db, outsider.id, { email: "x@s23.test", role: "member" }, now)).toEqual({ ok: false, reason: "not_admin" });
    expect(await createInvite(db, admin.id, { email: member.email, role: "member" }, now)).toEqual({ ok: false, reason: "already_member" });

    // An admin of another agency can't revoke this agency's invite.
    await invite(admin.id, "y@s23.test");
    const [row] = await listAgencyInvites(db, (await getMembership(db, admin.id))!.agencyId, now);
    expect(await revokeInvite(db, otherAdmin.id, row!.id, now)).toBe("not_found");
    expect(await revokeInvite(db, member.id, row!.id, now)).toBe("not_admin");
  });

  it("refuses an invite while the agent is in another agency", async () => {
    const admin = await lister("s23_admin5");
    await makeAgency(admin.id, "S23 Five");
    const erin = await lister("s23_erin");
    await makeAgency(erin.id, "S23 Erin");
    const token = await invite(admin.id, erin.email);
    expect(await acceptInvite(db, erin, byToken(token), now)).toEqual({ ok: false, reason: "already_in_agency" });
    expect((await getInvite(db, byToken(token), now))?.state).toBe("open");
  });

  /* ---------------------------------------------------------------------- */
  /* Roles, removal and leaving                                             */
  /* ---------------------------------------------------------------------- */

  it("keeps an admin: no demoting or leaving as the last one, and the only member can't leave", async () => {
    const admin = await lister("s23_solo");
    await makeAgency(admin.id);
    expect(await leaveAgency(db, admin.id, now)).toEqual({ ok: false, reason: "only_member" });

    const fay = await lister("s23_fay");
    await acceptInvite(db, fay, byToken(await invite(admin.id, fay.email)), now);
    expect(await setMemberRole(db, admin.id, admin.id, "member")).toEqual({ ok: false, reason: "last_admin" });
    expect(await leaveAgency(db, admin.id, now)).toEqual({ ok: false, reason: "last_admin" });

    expect(await setMemberRole(db, admin.id, fay.id, "admin")).toEqual({ ok: true });
    expect(await roles(fay.id)).toContain("agency_admin");
    expect(await setMemberRole(db, fay.id, admin.id, "member")).toEqual({ ok: true });
    expect(await roles(admin.id)).not.toContain("agency_admin");
    expect(await setMemberRole(db, admin.id, fay.id, "member")).toEqual({ ok: false, reason: "not_admin" });
  });

  it("removes a member: their listings leave with them and live ones pause until they have a plan", async () => {
    const admin = await lister("s23_admin6");
    const agency = await makeAgency(admin.id);
    await activePlan({ agencyId: agency.agencyId }, "s23_agency");
    const gil = await lister("s23_gil");
    const live = await listing(gil.id, "published", 1);
    await acceptInvite(db, gil, byToken(await invite(admin.id, gil.email)), now);
    expect((await statusOf(live)).status).toBe("published");

    const plain = await lister("s23_plain");
    await acceptInvite(db, plain, byToken(await invite(admin.id, plain.email)), now);
    expect(await removeMember(db, plain.id, gil.id, now)).toEqual({ ok: false, reason: "not_admin" });
    expect(await removeMember(db, admin.id, admin.id, now)).toEqual({ ok: false, reason: "self" });

    const removed = await removeMember(db, admin.id, gil.id, now);
    expect(removed).toMatchObject({ ok: true, paused: 1, agencyName: "S23 Realty", member: { email: gil.email } });
    expect(await getMembership(db, gil.id)).toBeNull();
    expect(await agencyOfListing(live)).toBeNull();
    expect(await statusOf(live)).toEqual({ status: "paused", pause_reason: "left_agency" });
    expect((await listMembers(db, agency.agencyId)).map((m) => m.userId).sort()).toEqual([admin.id, plain.id].sort());
  });

  it("lets a member leave, and refuses an admin of another agency acting on this one", async () => {
    const admin = await lister("s23_admin7");
    await makeAgency(admin.id);
    const hal = await lister("s23_hal");
    await acceptInvite(db, hal, byToken(await invite(admin.id, hal.email)), now);
    const otherAdmin = await lister("s23_other7");
    await makeAgency(otherAdmin.id, "S23 Seven");
    expect(await removeMember(db, otherAdmin.id, hal.id, now)).toEqual({ ok: false, reason: "not_member" });
    expect(await setMemberRole(db, otherAdmin.id, hal.id, "admin")).toEqual({ ok: false, reason: "not_member" });

    expect(await leaveAgency(db, hal.id, now)).toMatchObject({ ok: true });
    expect(await getMembership(db, hal.id)).toBeNull();
  });

  /* ---------------------------------------------------------------------- */
  /* Details, logo and the public page                                      */
  /* ---------------------------------------------------------------------- */

  it("only admins change details and logo; the slug never changes", async () => {
    const admin = await lister("s23_admin8");
    const agency = await makeAgency(admin.id);
    const ivy = await lister("s23_ivy");
    await acceptInvite(db, ivy, byToken(await invite(admin.id, ivy.email)), now);

    const details = { name: "S23 Renamed", description: null, website: "https://s23.example/" };
    expect(await updateAgencyDetails(db, ivy.id, details)).toBe("not_admin");
    expect(await updateAgencyDetails(db, admin.id, details)).toBe("saved");
    expect(await getMembership(db, admin.id)).toMatchObject({ name: "S23 Renamed", slug: agency.slug, websiteUrl: "https://s23.example/" });

    expect(await setAgencyLogo(db, ivy.id, agency.agencyId, "avatars/x/y")).toBeUndefined();
    expect(await setAgencyLogo(db, admin.id, agency.agencyId, `avatars/agency-${agency.agencyId}/new`)).toBeNull();
  });

  it("shows a public page only with a published listing, and only members who have one", async () => {
    const admin = await lister("s23_admin9");
    const agency = await makeAgency(admin.id);
    expect(await getPublicAgency(db, agency.slug)).toBeNull();

    await activePlan({ agencyId: agency.agencyId }, "s23_agency");
    const jo = await lister("s23_jo");
    await acceptInvite(db, jo, byToken(await invite(admin.id, jo.email)), now);
    const id = await listing(jo.id, "published", 1);
    await client.query(`update properties set agency_id = $1 where id = $2`, [agency.agencyId, id]);

    const result = await getPublicAgency(db, agency.slug);
    expect(result?.agency).toEqual({ name: "S23 Realty", slug: agency.slug, description: "Test agency", websiteUrl: null, logoKey: null });
    const team = await getPublicTeam(db, agency.agencyId);
    expect(team).toEqual([{ displayName: "Lister s23_jo", avatarKey: null, listerType: "agent", verified: false }]);
    // Nothing private in the public shapes: exact keys above, and no emails or phone numbers.
    expect(JSON.stringify({ agency: result?.agency, team })).not.toMatch(/@|\+254/);
    expect(Object.keys(team[0]!).sort()).toEqual(["avatarKey", "displayName", "listerType", "verified"]);
  });

  it("lists agencies with published listings in the directory, most listings first (prompt S24)", async () => {
    // Only this test's listings are live inside the rolled-back transaction.
    await client.query(`update properties set status = 'archived' where status = 'published'`);
    const publish = async (agencyId: string, owner: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const id = await listing(owner, "published", i + 1);
        await client.query(`update properties set agency_id = $1 where id = $2`, [agencyId, id]);
      }
    };
    const a = await lister("s23_dir_a");
    const b = await lister("s23_dir_b");
    const c = await lister("s23_dir_c");
    const d = await lister("s23_dir_d");
    const big = await makeAgency(a.id, "S23 Zebra Homes");
    const small = await makeAgency(b.id, "S23 Alpha Homes");
    const tie = await makeAgency(c.id, "S23 Beta Homes");
    const empty = await makeAgency(d.id, "S23 Empty Homes");
    await publish(big.agencyId, a.id, 3);
    await publish(small.agencyId, b.id, 1);
    await publish(tie.agencyId, c.id, 1);
    const paused = await listing(d.id, "paused", 1);
    await client.query(`update properties set agency_id = $1 where id = $2`, [empty.agencyId, paused]);

    const directory = await listAgencyDirectory(db, 1);
    expect(directory.total).toBe(3);
    expect(directory.items).toEqual([
      { name: "S23 Zebra Homes", slug: big.slug, logoKey: null, listingCount: 3 },
      { name: "S23 Alpha Homes", slug: small.slug, logoKey: null, listingCount: 1 },
      { name: "S23 Beta Homes", slug: tie.slug, logoKey: null, listingCount: 1 },
    ]);
    // A page past the end shows the last page.
    expect((await listAgencyDirectory(db, 99)).page).toBe(1);
  });

  it("prunes invites 90 days after they close", async () => {
    const admin = await lister("s23_admin10");
    await makeAgency(admin.id);
    await invite(admin.id, "old@s23.test");
    await invite(admin.id, "fresh@s23.test");
    await client.query(`update agency_invites set expires_at = now() - interval '100 days' where email = 'old@s23.test'`);
    expect(await pruneAgencyInvites(db, now)).toBeGreaterThanOrEqual(1);
    expect(await all(`select email from agency_invites where email like '%@s23.test' order by email`)).toEqual([{ email: "fresh@s23.test" }]);
  });

  it("allows one agency per user in the database itself", async () => {
    const admin = await lister("s23_admin11");
    const first = await makeAgency(admin.id, "S23 First");
    const other = await one<{ id: string }>(`insert into agencies (name, slug) values ('S23 Second', 's23-second') returning id`);
    await expect(client.query(`insert into agency_members (agency_id, user_id) values ($1, $2)`, [other.id, admin.id])).rejects.toThrow(
      /agency_members_one_agency_per_user/,
    );
    expect(first.ok).toBe(true);
  });
});
