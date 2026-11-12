import "server-only";
import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, agencyMembers, listerProfiles, properties, subscriptions, users } from "@/db/schema";
import { agencySlugBase, agencySlugCandidate } from "@/lib/agencies/slug";
import { agencyFreeSlots, planJoin, type JoinPlan, type LiveListing, type PersonalPlan } from "@/lib/agencies/join-plan";
import { applyKeepSelection } from "@/lib/billing/plan-schedule";
import { ACTIVE_LISTING_STATUSES } from "@/lib/billing/constants";
import type { AgencyDetailsInput, AgencyRole, CreateAgencyInput } from "@/lib/validation/agency";
import { countActiveListings, getListingSubscription } from "./billing";
import { insertBillingAudit } from "./billing-admin";
import { lockPool } from "./listings";
import { lockLiveSubscription, openInvoices, recordPaymentEvent, voidInvoices } from "./payments";
import { grantRoles, revokeRoles } from "./roles";

/**
 * Agencies (prompt S23). The caller's agency is always the one on their own lister profile, never
 * an id from the browser, and every change re-checks `agency_members.role` inside the transaction.
 * Join, leave, remove and role changes each run in one transaction that keeps the listing pools
 * (`properties.agency_id` ↔ `lister_profiles.agency_id`) and the `agency_admin` role in step.
 */

/** Listings that never move between pools: archived is final. */
const MOVABLE = ne(properties.status, "archived");
const SLUG_ATTEMPTS = 25;

/** Why a lister's listing was paused when they left an agency; restored by their own plan. */
export const LEFT_AGENCY_PAUSE_REASON = "left_agency";

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface AgencyMembership {
  agencyId: string;
  name: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  logoKey: string | null;
  /** Null when the profile points at the agency without a member row (operator data). */
  role: AgencyRole | null;
}

/** The agency on the caller's lister profile and their role in it, or null. */
export async function getMembership(db: DbExecutor, userId: string): Promise<AgencyMembership | null> {
  const [row] = await db
    .select({
      agencyId: agencies.id,
      name: agencies.name,
      slug: agencies.slug,
      description: agencies.description,
      websiteUrl: agencies.websiteUrl,
      logoKey: agencies.logoKey,
      role: agencyMembers.role,
    })
    .from(listerProfiles)
    .innerJoin(agencies, eq(agencies.id, listerProfiles.agencyId))
    .leftJoin(agencyMembers, and(eq(agencyMembers.agencyId, agencies.id), eq(agencyMembers.userId, userId)))
    .where(eq(listerProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

export interface AgencyMemberRow {
  userId: string;
  displayName: string;
  avatarKey: string | null;
  role: AgencyRole;
  joinedAt: Date;
  /** Published or in review under this agency. */
  liveListings: number;
}

/** Members of an agency, admins first. For the agency's own members only (account page). */
export async function listMembers(db: DbExecutor, agencyId: string): Promise<AgencyMemberRow[]> {
  const live = db
    .select({ ownerUserId: properties.ownerUserId, n: count().as("n") })
    .from(properties)
    .where(and(eq(properties.agencyId, agencyId), inArray(properties.status, [...ACTIVE_LISTING_STATUSES])))
    .groupBy(properties.ownerUserId)
    .as("live");
  const rows = await db
    .select({
      userId: agencyMembers.userId,
      displayName: sql<string>`coalesce(${listerProfiles.displayName}, ${users.name})`,
      avatarKey: listerProfiles.avatarKey,
      role: agencyMembers.role,
      joinedAt: agencyMembers.createdAt,
      liveListings: sql<number>`coalesce(${live.n}, 0)::int`,
    })
    .from(agencyMembers)
    .innerJoin(users, eq(users.id, agencyMembers.userId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, agencyMembers.userId))
    .leftJoin(live, eq(live.ownerUserId, agencyMembers.userId))
    .where(eq(agencyMembers.agencyId, agencyId))
    .orderBy(asc(agencyMembers.role), asc(agencyMembers.createdAt));
  return rows;
}

async function joinerLiveListings(db: DbExecutor, userId: string, lock: boolean): Promise<LiveListing[]> {
  const query = db
    .select({ id: properties.id, status: properties.status, publishedAt: properties.publishedAt })
    .from(properties)
    .where(and(eq(properties.ownerUserId, userId), inArray(properties.status, [...ACTIVE_LISTING_STATUSES])));
  const rows = lock ? await query.for("update") : await query;
  return rows as LiveListing[];
}

async function personalPlanOf(db: DbExecutor, userId: string, now: Date): Promise<PersonalPlan | null> {
  const plan = await getListingSubscription(db, { kind: "user", userId }, now);
  if (!plan) return null;
  const paid = plan.subscription.status !== "pending";
  return { name: plan.plan.name, paidUntil: paid ? plan.subscription.currentPeriodEnd : null };
}

async function freeSlotsOf(db: DbExecutor, agencyId: string | null, now: Date): Promise<number> {
  if (!agencyId) return 0;
  const pool = { kind: "agency", agencyId } as const;
  // Sequential: this also runs inside the join transaction's single connection.
  const plan = await getListingSubscription(db, pool, now);
  const activeListingCount = await countActiveListings(db, pool);
  return agencyFreeSlots({
    subscription: plan?.subscription ?? null,
    listingLimit: plan?.listingLimit ?? null,
    activeListingCount,
    now,
  });
}

/** What joining `agencyId` (or a new agency, when null) would do now: the warning's numbers. */
export async function previewJoin(db: DbExecutor, userId: string, agencyId: string | null, now: Date): Promise<JoinPlan> {
  const [joinerLive, freeSlots, personalPlan] = await Promise.all([
    joinerLiveListings(db, userId, false),
    freeSlotsOf(db, agencyId, now),
    personalPlanOf(db, userId, now),
  ]);
  return planJoin({ joinerLive, freeSlots, personalPlan });
}

/* -------------------------------------------------------------------------- */
/* Joining                                                                    */
/* -------------------------------------------------------------------------- */

export type JoinBlock = "no_profile" | "already_in_agency";

/** Locks the caller's profile row; tells why they can't join an agency, if they can't. */
async function lockJoinerProfile(tx: DbExecutor, userId: string): Promise<JoinBlock | null> {
  const [profile] = await tx
    .select({ agencyId: listerProfiles.agencyId })
    .from(listerProfiles)
    .where(eq(listerProfiles.userId, userId))
    .for("update")
    .limit(1);
  if (!profile) return "no_profile";
  if (profile.agencyId) return "already_in_agency";
  const [member] = await tx.select({ id: agencyMembers.agencyId }).from(agencyMembers).where(eq(agencyMembers.userId, userId)).limit(1);
  return member ? "already_in_agency" : null;
}

/** Cancels the joiner's own listing plan (decision 5.4): audited, open invoices voided. */
async function cancelPersonalListingPlan(tx: DbExecutor, userId: string, agencyName: string, now: Date): Promise<void> {
  const sub = await lockLiveSubscription(tx, { kind: "user", userId }, "listing");
  if (!sub) return;
  await tx.update(subscriptions).set({ status: "cancelled", cancelledAt: now }).where(eq(subscriptions.id, sub.id));
  const open = (await openInvoices(tx, sub.id)).map((invoice) => invoice.id);
  await voidInvoices(tx, open, now);
  for (const invoiceId of open) {
    await recordPaymentEvent(tx, {
      eventType: "status_change",
      invoiceId,
      payload: { entity: "invoice", invoiceId, to: "void", reason: "agency_join" },
    });
  }
  await recordPaymentEvent(tx, {
    eventType: "status_change",
    payload: { entity: "subscription", subscriptionId: sub.id, from: sub.status, to: "cancelled", reason: "agency_join" },
  });
  await insertBillingAudit(tx, {
    actorUserId: userId,
    action: "agency_join_plan_cancelled",
    subscriptionId: sub.id,
    reason: `Joined agency ${agencyName}`,
  });
}

/**
 * Moves the joiner in (decision 5). The caller has locked the joiner's profile and checked they
 * may join. Pools are locked before anything is counted, so parallel joins can't overfill.
 */
async function joinCore(
  tx: DbExecutor,
  { userId, agencyId, agencyName, role, now }: { userId: string; agencyId: string; agencyName: string; role: AgencyRole; now: Date },
): Promise<JoinPlan> {
  // Same order as `detach` (agency, then user), so a join and a leave can't deadlock.
  await lockPool(tx, { kind: "agency", agencyId });
  await lockPool(tx, { kind: "user", userId });

  // One connection inside the transaction: read in sequence.
  const joinerLive = await joinerLiveListings(tx, userId, true);
  const freeSlots = await freeSlotsOf(tx, agencyId, now);
  const personalPlan = await personalPlanOf(tx, userId, now);
  const plan = planJoin({ joinerLive, freeSlots, personalPlan });

  await tx.insert(agencyMembers).values({ agencyId, userId, role });
  await tx.update(listerProfiles).set({ agencyId }).where(eq(listerProfiles.userId, userId));
  await tx
    .update(properties)
    .set({ agencyId })
    .where(and(eq(properties.ownerUserId, userId), MOVABLE));
  await cancelPersonalListingPlan(tx, userId, agencyName, now);
  await applyKeepSelection(tx, joinerLive, new Set(plan.keepIds), now);
  if (role === "admin") await grantRoles(tx, userId, ["agency_admin"]);
  return plan;
}

export type CreateAgencyResult = { ok: true; agencyId: string; slug: string; plan: JoinPlan } | { ok: false; reason: JoinBlock };

/** Creates an agency with the caller as its admin, moving them in like a join (decision 3). */
export async function createAgency(tx: DbExecutor, userId: string, input: CreateAgencyInput, now: Date): Promise<CreateAgencyResult> {
  const blocked = await lockJoinerProfile(tx, userId);
  if (blocked) return { ok: false, reason: blocked };

  const base = agencySlugBase(input.name);
  let created: { id: string; slug: string } | undefined;
  for (let attempt = 1; attempt <= SLUG_ATTEMPTS && !created; attempt++) {
    [created] = await tx
      .insert(agencies)
      .values({ name: input.name, slug: agencySlugCandidate(base, attempt), description: input.description })
      .onConflictDoNothing({ target: agencies.slug })
      .returning({ id: agencies.id, slug: agencies.slug });
  }
  if (!created) throw new Error("Could not allocate an agency slug");

  const plan = await joinCore(tx, { userId, agencyId: created.id, agencyName: input.name, role: "admin", now });
  console.info(`[agency] created agency=${created.id} paused=${plan.pauseIds.length} draft=${plan.toDraftIds.length}`);
  return { ok: true, agencyId: created.id, slug: created.slug, plan };
}

/** Joins an existing agency; used by invite acceptance, which has checked the invite. */
export async function joinAgency(
  tx: DbExecutor,
  { userId, agencyId, role, now }: { userId: string; agencyId: string; role: AgencyRole; now: Date },
): Promise<{ ok: true; plan: JoinPlan; agencyName: string } | { ok: false; reason: JoinBlock }> {
  const blocked = await lockJoinerProfile(tx, userId);
  if (blocked) return { ok: false, reason: blocked };
  const [agency] = await tx.select({ name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  if (!agency) throw new Error("Agency not found");
  const plan = await joinCore(tx, { userId, agencyId, agencyName: agency.name, role, now });
  console.info(`[agency] joined agency=${agencyId} paused=${plan.pauseIds.length} draft=${plan.toDraftIds.length}`);
  return { ok: true, plan, agencyName: agency.name };
}

/* -------------------------------------------------------------------------- */
/* Admin checks                                                               */
/* -------------------------------------------------------------------------- */

/** The caller's agency id if they are an admin member of it (row locked), else null. */
async function lockCallerAdminAgency(tx: DbExecutor, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ agencyId: agencyMembers.agencyId })
    .from(agencyMembers)
    .innerJoin(listerProfiles, and(eq(listerProfiles.userId, agencyMembers.userId), eq(listerProfiles.agencyId, agencyMembers.agencyId)))
    .where(and(eq(agencyMembers.userId, userId), eq(agencyMembers.role, "admin")))
    .for("update", { of: agencyMembers })
    .limit(1);
  return row?.agencyId ?? null;
}

/** All member rows of an agency, locked: the last-admin and last-member rules read these. */
async function lockMemberRows(tx: DbExecutor, agencyId: string) {
  return tx
    .select({ userId: agencyMembers.userId, role: agencyMembers.role })
    .from(agencyMembers)
    .where(eq(agencyMembers.agencyId, agencyId))
    .for("update");
}

/* -------------------------------------------------------------------------- */
/* Leaving, removal and roles                                                 */
/* -------------------------------------------------------------------------- */

export type DetachBlock = "not_member" | "last_admin" | "only_member";

/**
 * Takes a member out (decision 7): their listings leave with them and the live ones are paused
 * until they have their own plan. Conversations and inquiries already belong to the owner user.
 */
async function detach(tx: DbExecutor, agencyId: string, memberId: string, now: Date): Promise<{ ok: true; paused: number } | { ok: false; reason: DetachBlock }> {
  const members = await lockMemberRows(tx, agencyId);
  const member = members.find((m) => m.userId === memberId);
  if (!member) return { ok: false, reason: "not_member" };
  if (members.length === 1) return { ok: false, reason: "only_member" };
  const admins = members.filter((m) => m.role === "admin");
  if (member.role === "admin" && admins.length === 1) return { ok: false, reason: "last_admin" };

  await lockPool(tx, { kind: "agency", agencyId });
  await lockPool(tx, { kind: "user", userId: memberId });
  await tx.delete(agencyMembers).where(and(eq(agencyMembers.agencyId, agencyId), eq(agencyMembers.userId, memberId)));
  await tx
    .update(listerProfiles)
    .set({ agencyId: null })
    .where(and(eq(listerProfiles.userId, memberId), eq(listerProfiles.agencyId, agencyId)));
  await tx
    .update(properties)
    .set({ agencyId: null })
    .where(and(eq(properties.ownerUserId, memberId), eq(properties.agencyId, agencyId)));
  const paused = await tx
    .update(properties)
    .set({ status: "paused", pausedAt: now, pauseReason: LEFT_AGENCY_PAUSE_REASON })
    .where(and(eq(properties.ownerUserId, memberId), eq(properties.status, "published"), isNull(properties.agencyId)))
    .returning({ id: properties.id });
  if (member.role === "admin") await revokeRoles(tx, memberId, ["agency_admin"]);
  console.info(`[agency] member left agency=${agencyId} paused=${paused.length}`);
  return { ok: true, paused: paused.length };
}

export async function leaveAgency(tx: DbExecutor, userId: string, now: Date) {
  const [row] = await tx
    .select({ agencyId: agencyMembers.agencyId })
    .from(agencyMembers)
    .where(eq(agencyMembers.userId, userId))
    .limit(1);
  if (!row) return { ok: false as const, reason: "not_member" as const };
  return detach(tx, row.agencyId, userId, now);
}

export type AdminActionBlock = "not_admin" | "not_member" | "self";

/** An admin removes another member of their own agency. Returns the agency name for the email. */
export async function removeMember(
  tx: DbExecutor,
  adminId: string,
  memberId: string,
  now: Date,
): Promise<
  | { ok: true; paused: number; agencyName: string; member: { name: string; email: string; emailVerified: boolean } }
  | { ok: false; reason: AdminActionBlock | DetachBlock }
> {
  if (adminId === memberId) return { ok: false, reason: "self" };
  const agencyId = await lockCallerAdminAgency(tx, adminId);
  if (!agencyId) return { ok: false, reason: "not_admin" };
  const result = await detach(tx, agencyId, memberId, now);
  if (!result.ok) return result;
  const [agency] = await tx.select({ name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId));
  // For the removal email only; never logged.
  const [member] = await tx
    .select({ name: users.name, email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, memberId));
  return { ...result, agencyName: agency?.name ?? "the agency", member: member ?? { name: "", email: "", emailVerified: false } };
}

/** Makes a member an admin or a plain member; never demotes the last admin. */
export async function setMemberRole(
  tx: DbExecutor,
  adminId: string,
  memberId: string,
  role: AgencyRole,
): Promise<{ ok: true } | { ok: false; reason: AdminActionBlock | "last_admin" }> {
  const agencyId = await lockCallerAdminAgency(tx, adminId);
  if (!agencyId) return { ok: false, reason: "not_admin" };
  const members = await lockMemberRows(tx, agencyId);
  const member = members.find((m) => m.userId === memberId);
  if (!member) return { ok: false, reason: "not_member" };
  if (member.role === role) return { ok: true };
  if (role === "member" && members.filter((m) => m.role === "admin").length === 1) return { ok: false, reason: "last_admin" };

  await tx
    .update(agencyMembers)
    .set({ role })
    .where(and(eq(agencyMembers.agencyId, agencyId), eq(agencyMembers.userId, memberId)));
  if (role === "admin") await grantRoles(tx, memberId, ["agency_admin"]);
  else await revokeRoles(tx, memberId, ["agency_admin"]);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Agency details and logo                                                    */
/* -------------------------------------------------------------------------- */

export async function updateAgencyDetails(tx: DbExecutor, adminId: string, input: AgencyDetailsInput): Promise<"saved" | "not_admin"> {
  const agencyId = await lockCallerAdminAgency(tx, adminId);
  if (!agencyId) return "not_admin";
  await tx
    .update(agencies)
    .set({ name: input.name, description: input.description, websiteUrl: input.website })
    .where(eq(agencies.id, agencyId));
  return "saved";
}

/** The caller's agency id when they may change its logo (an admin), else null. Read-only check. */
export async function adminAgencyId(db: DbExecutor, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ agencyId: agencyMembers.agencyId })
    .from(agencyMembers)
    .innerJoin(listerProfiles, and(eq(listerProfiles.userId, agencyMembers.userId), eq(listerProfiles.agencyId, agencyMembers.agencyId)))
    .where(and(eq(agencyMembers.userId, userId), eq(agencyMembers.role, "admin")))
    .limit(1);
  return row?.agencyId ?? null;
}

/**
 * Points the agency at a new logo, only if the caller is still an admin of `agencyId`. Returns the
 * key it replaced, or `undefined` when nothing was written.
 */
export async function setAgencyLogo(tx: DbExecutor, adminId: string, agencyId: string, baseKey: string | null): Promise<string | null | undefined> {
  if ((await lockCallerAdminAgency(tx, adminId)) !== agencyId) return undefined;
  const [previous] = await tx.select({ key: agencies.logoKey }).from(agencies).where(eq(agencies.id, agencyId)).for("update").limit(1);
  if (!previous) return undefined;
  await tx.update(agencies).set({ logoKey: baseKey }).where(eq(agencies.id, agencyId));
  return previous.key;
}

/** Which of these avatar-store base keys an agency still uses as its logo (orphan sweep). */
export async function referencedLogoKeys(db: DbExecutor, baseKeys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < baseKeys.length; i += 500) {
    const rows = await db
      .select({ key: agencies.logoKey })
      .from(agencies)
      .where(inArray(agencies.logoKey, baseKeys.slice(i, i + 500)));
    for (const row of rows) if (row.key) found.add(row.key);
  }
  return found;
}
