import "server-only";
import { and, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, agencyInvites, agencyMembers, listerProfiles, users } from "@/db/schema";
import { INVITE_TTL_DAYS, newInviteToken } from "@/lib/agencies/invite-token";
import { DAY_MS } from "@/lib/billing/constants";
import type { JoinPlan } from "@/lib/agencies/join-plan";
import type { AgencyRole, InviteInput } from "@/lib/validation/agency";
import { joinAgency, type JoinBlock } from "./agencies";

/**
 * Agency invites (prompt S23 decision 4). The raw token is returned once, to the action that
 * emails it; only its hash is stored. Accepting needs the signed-in user's verified email to match
 * the invite, so a forwarded link is useless to anyone else.
 */

export const MAX_OPEN_INVITES = 50;
/** Invite rows (and the email in them) are deleted this long after they close (privacy policy). */
export const INVITE_RETENTION_DAYS = 90;
/** Declined invites stay on the admin's list this long. */
const DECLINED_SHOWN_DAYS = 14;

/** How an invite is looked up: by the token's hash (email link) or by id (account page list). */
export type InviteLookup = { kind: "hash"; hash: string } | { kind: "id"; id: string };

const lookupWhere = (lookup: InviteLookup) =>
  lookup.kind === "hash" ? eq(agencyInvites.tokenHash, lookup.hash) : eq(agencyInvites.id, lookup.id);

export type InviteState = "open" | "expired" | "revoked" | "declined" | "accepted";

export function inviteState(
  row: { acceptedAt: Date | null; revokedAt: Date | null; declined: boolean; expiresAt: Date },
  now: Date,
): InviteState {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return row.declined ? "declined" : "revoked";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "open";
}

/* -------------------------------------------------------------------------- */
/* Admin side                                                                 */
/* -------------------------------------------------------------------------- */

/** The caller's agency if they are its admin, with what the invite email needs. */
async function lockAdminAgency(tx: DbExecutor, adminId: string) {
  const [row] = await tx
    .select({ agencyId: agencies.id, agencyName: agencies.name, inviterName: listerProfiles.displayName })
    .from(agencyMembers)
    .innerJoin(listerProfiles, and(eq(listerProfiles.userId, agencyMembers.userId), eq(listerProfiles.agencyId, agencyMembers.agencyId)))
    .innerJoin(agencies, eq(agencies.id, agencyMembers.agencyId))
    .where(and(eq(agencyMembers.userId, adminId), eq(agencyMembers.role, "admin")))
    .for("update", { of: agencyMembers })
    .limit(1);
  return row ?? null;
}

export type CreateInviteResult =
  | { ok: true; token: string; agencyName: string; inviterName: string; expiresAt: Date }
  | { ok: false; reason: "not_admin" | "already_member" | "too_many" };

export async function createInvite(tx: DbExecutor, adminId: string, invite: InviteInput, now: Date): Promise<CreateInviteResult> {
  // Lower-cased here too, whatever the caller parsed: matching and the unique index rely on it.
  const input = { ...invite, email: invite.email.trim().toLowerCase() };
  const admin = await lockAdminAgency(tx, adminId);
  if (!admin) return { ok: false, reason: "not_admin" };

  const [member] = await tx
    .select({ id: agencyMembers.userId })
    .from(agencyMembers)
    .innerJoin(users, eq(users.id, agencyMembers.userId))
    .where(and(eq(agencyMembers.agencyId, admin.agencyId), sql`lower(${users.email}) = ${input.email}`))
    .limit(1);
  if (member) return { ok: false, reason: "already_member" };

  // Re-inviting replaces the old link.
  await tx
    .update(agencyInvites)
    .set({ revokedAt: now })
    .where(
      and(eq(agencyInvites.agencyId, admin.agencyId), eq(agencyInvites.email, input.email), isNull(agencyInvites.acceptedAt), isNull(agencyInvites.revokedAt)),
    );
  const [open] = await tx
    .select({ n: count() })
    .from(agencyInvites)
    .where(
      and(eq(agencyInvites.agencyId, admin.agencyId), isNull(agencyInvites.acceptedAt), isNull(agencyInvites.revokedAt), gt(agencyInvites.expiresAt, now)),
    );
  if ((open?.n ?? 0) >= MAX_OPEN_INVITES) return { ok: false, reason: "too_many" };

  const { token, hash } = newInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
  await tx.insert(agencyInvites).values({
    agencyId: admin.agencyId,
    email: input.email,
    role: input.role,
    tokenHash: hash,
    invitedBy: adminId,
    expiresAt,
  });
  console.info(`[agency] invite created agency=${admin.agencyId} role=${input.role}`);
  return { ok: true, token, agencyName: admin.agencyName, inviterName: admin.inviterName, expiresAt };
}

export interface AdminInviteRow {
  id: string;
  email: string;
  role: AgencyRole;
  state: InviteState;
  expiresAt: Date;
  createdAt: Date;
}

/** Open and expired invites, and recent declines, for the agency's admins. */
export async function listAgencyInvites(db: DbExecutor, agencyId: string, now: Date): Promise<AdminInviteRow[]> {
  const declinedSince = new Date(now.getTime() - DECLINED_SHOWN_DAYS * DAY_MS);
  const rows = await db
    .select({
      id: agencyInvites.id,
      email: agencyInvites.email,
      role: agencyInvites.role,
      expiresAt: agencyInvites.expiresAt,
      createdAt: agencyInvites.createdAt,
      acceptedAt: agencyInvites.acceptedAt,
      revokedAt: agencyInvites.revokedAt,
      declined: agencyInvites.declined,
    })
    .from(agencyInvites)
    .where(
      and(
        eq(agencyInvites.agencyId, agencyId),
        isNull(agencyInvites.acceptedAt),
        or(isNull(agencyInvites.revokedAt), and(eq(agencyInvites.declined, true), gt(agencyInvites.revokedAt, declinedSince))),
      ),
    )
    .orderBy(desc(agencyInvites.createdAt))
    .limit(MAX_OPEN_INVITES * 2);
  return rows.map(({ acceptedAt, revokedAt, declined, ...row }) => ({ ...row, state: inviteState({ acceptedAt, revokedAt, declined, expiresAt: row.expiresAt }, now) }));
}

export async function revokeInvite(tx: DbExecutor, adminId: string, inviteId: string, now: Date): Promise<"revoked" | "not_admin" | "not_found"> {
  const admin = await lockAdminAgency(tx, adminId);
  if (!admin) return "not_admin";
  const rows = await tx
    .update(agencyInvites)
    .set({ revokedAt: now })
    .where(and(eq(agencyInvites.id, inviteId), eq(agencyInvites.agencyId, admin.agencyId), isNull(agencyInvites.acceptedAt), isNull(agencyInvites.revokedAt)))
    .returning({ id: agencyInvites.id });
  return rows.length > 0 ? "revoked" : "not_found";
}

/* -------------------------------------------------------------------------- */
/* Invitee side                                                               */
/* -------------------------------------------------------------------------- */

export interface InviteView {
  id: string;
  agencyId: string;
  agencyName: string;
  agencySlug: string;
  agencyLogoKey: string | null;
  inviterName: string | null;
  /** Lower-cased; shown only masked to anyone but its owner. */
  email: string;
  role: AgencyRole;
  state: InviteState;
  expiresAt: Date;
}

function inviteViewQuery(db: DbExecutor) {
  return db
    .select({
      id: agencyInvites.id,
      agencyId: agencies.id,
      agencyName: agencies.name,
      agencySlug: agencies.slug,
      agencyLogoKey: agencies.logoKey,
      inviterName: listerProfiles.displayName,
      email: agencyInvites.email,
      role: agencyInvites.role,
      expiresAt: agencyInvites.expiresAt,
      acceptedAt: agencyInvites.acceptedAt,
      revokedAt: agencyInvites.revokedAt,
      declined: agencyInvites.declined,
    })
    .from(agencyInvites)
    .innerJoin(agencies, eq(agencies.id, agencyInvites.agencyId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, agencyInvites.invitedBy));
}

type InviteViewRow = Awaited<ReturnType<ReturnType<typeof inviteViewQuery>["where"]>>[number];

function toView({ acceptedAt, revokedAt, declined, ...row }: InviteViewRow, now: Date): InviteView {
  return { ...row, state: inviteState({ acceptedAt, revokedAt, declined, expiresAt: row.expiresAt }, now) };
}

export async function getInvite(db: DbExecutor, lookup: InviteLookup, now: Date): Promise<InviteView | null> {
  const [row] = await inviteViewQuery(db).where(lookupWhere(lookup)).limit(1);
  return row ? toView(row, now) : null;
}

/** Open invites addressed to this (verified) email, for the account page. */
export async function openInvitesFor(db: DbExecutor, email: string, now: Date): Promise<InviteView[]> {
  const rows = await inviteViewQuery(db)
    .where(
      and(eq(agencyInvites.email, email.toLowerCase()), isNull(agencyInvites.acceptedAt), isNull(agencyInvites.revokedAt), gt(agencyInvites.expiresAt, now)),
    )
    .orderBy(desc(agencyInvites.createdAt))
    .limit(20);
  return rows.map((row) => toView(row, now));
}

export type AcceptBlock = JoinBlock | "not_found" | "wrong_email" | "expired" | "revoked" | "declined" | "accepted";

/** Locks the invite and checks it is open and addressed to this user. */
async function lockInviteFor(tx: DbExecutor, lookup: InviteLookup, user: { email: string }, now: Date) {
  const [row] = await tx.select().from(agencyInvites).where(lookupWhere(lookup)).for("update").limit(1);
  if (!row) return { ok: false as const, reason: "not_found" as const };
  const state = inviteState(row, now);
  if (state !== "open") return { ok: false as const, reason: state };
  if (row.email !== user.email.toLowerCase()) return { ok: false as const, reason: "wrong_email" as const };
  return { ok: true as const, invite: row };
}

export async function acceptInvite(
  tx: DbExecutor,
  user: { id: string; email: string },
  lookup: InviteLookup,
  now: Date,
): Promise<{ ok: true; agencyName: string; plan: JoinPlan } | { ok: false; reason: AcceptBlock }> {
  const locked = await lockInviteFor(tx, lookup, user, now);
  if (!locked.ok) return locked;
  const joined = await joinAgency(tx, { userId: user.id, agencyId: locked.invite.agencyId, role: locked.invite.role, now });
  if (!joined.ok) return joined;
  await tx.update(agencyInvites).set({ acceptedAt: now, acceptedBy: user.id }).where(eq(agencyInvites.id, locked.invite.id));
  return { ok: true, agencyName: joined.agencyName, plan: joined.plan };
}

export async function declineInvite(
  tx: DbExecutor,
  user: { email: string },
  lookup: InviteLookup,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: Exclude<AcceptBlock, JoinBlock> }> {
  const locked = await lockInviteFor(tx, lookup, user, now);
  if (!locked.ok) return locked;
  await tx.update(agencyInvites).set({ revokedAt: now, declined: true }).where(eq(agencyInvites.id, locked.invite.id));
  return { ok: true };
}

/**
 * Deletes invites that closed (accepted, revoked, declined or expired) more than
 * INVITE_RETENTION_DAYS ago. Run by the daily storage-cleanup job.
 */
export async function pruneAgencyInvites(db: DbExecutor, now: Date): Promise<number> {
  const before = new Date(now.getTime() - INVITE_RETENTION_DAYS * DAY_MS);
  const deleted = await db
    .delete(agencyInvites)
    .where(lt(sql`coalesce(${agencyInvites.acceptedAt}, ${agencyInvites.revokedAt}, ${agencyInvites.expiresAt})`, before))
    .returning({ id: agencyInvites.id });
  return deleted.length;
}
