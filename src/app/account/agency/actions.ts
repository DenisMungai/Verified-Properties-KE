"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAgency,
  leaveAgency,
  removeMember,
  setMemberRole,
  updateAgencyDetails,
} from "@/db/queries/agencies";
import { acceptInvite, createInvite, declineInvite, revokeInvite, type InviteLookup } from "@/db/queries/agency-invites";
import { type ActionState, fieldErrorsFrom, keepValues } from "@/lib/action-state";
import { hashInviteToken, invitePath, isWellFormedInviteToken } from "@/lib/agencies/invite-token";
import { getBillingDeps } from "@/lib/billing/app-deps";
import { agencyInviteEmail, agencyRemovedEmail } from "@/lib/email/templates";
import { formatNairobiDate } from "@/lib/format";
import {
  POLICIES,
  RateLimitUnavailableError,
  checkRateLimits,
  rateLimitKey,
  tooManyAttemptsMessage,
  type RateLimitPolicy,
} from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import {
  agencyDetailsSchema,
  createAgencySchema,
  inviteIdSchema,
  inviteSchema,
  memberIdSchema,
  memberRoleChangeSchema,
} from "@/lib/validation/agency";
import { requireLister } from "../listings/guard";

/**
 * Agency Server Actions (prompt S23). Each one checks the session, validates with Zod, applies a
 * rate limit and calls one transaction. The agency is never taken from the form: the queries find
 * the caller's own agency and re-check their role inside the transaction. Logs carry no emails,
 * tokens or phone numbers.
 */

const AGENCY_PATH = "/account/agency";
const GENERIC_FAILURE = "Something went wrong. Please try again.";

function logFailure(action: string, error: unknown): void {
  console.error(`[agency] ${action} failed`, error instanceof Error ? error.name : "unknown");
}

/** A rate-limit message, or null when the caller may go ahead. Throws RateLimitUnavailableError. */
async function limited(policy: RateLimitPolicy, userId: string): Promise<string | null> {
  const result = await checkRateLimits([[policy, rateLimitKey(userId)]]);
  return result.ok ? null : tooManyAttemptsMessage(result.retryAfterSeconds);
}

function refreshAgencyPages(): void {
  // Roles and the account menu may have changed.
  revalidatePath("/account", "layout");
}

/** `?updated=…&paused=2&drafted=1` for the flash after joining or creating. */
function joinOutcome(kind: "created" | "joined", plan: { pauseIds: string[]; toDraftIds: string[] }): string {
  return `updated=${kind}&paused=${plan.pauseIds.length}&drafted=${plan.toDraftIds.length}`;
}

/* -------------------------------------------------------------------------- */
/* Create and edit                                                            */
/* -------------------------------------------------------------------------- */

const CREATE_FIELDS = ["name", "description"] as const;

export async function createAgencyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireLister(AGENCY_PATH);
  const values = keepValues(formData, CREATE_FIELDS);
  const parsed = createAgencySchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const deps = getBillingDeps();
  let outcome: string;
  try {
    const tooMany = await limited(POLICIES.agencyCreatePerUser, user.id);
    if (tooMany) return { formError: tooMany, values };
    const result = await deps.withTransaction((tx) => createAgency(tx, user.id, parsed.data, deps.now()));
    if (!result.ok) {
      return {
        formError: result.reason === "already_in_agency" ? "You're already part of an agency. Leave it first to start a new one." : GENERIC_FAILURE,
        values,
      };
    }
    outcome = joinOutcome("created", result.plan);
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("create", error);
    return { formError: GENERIC_FAILURE, values };
  }
  refreshAgencyPages();
  redirect(`${AGENCY_PATH}?${outcome}`);
}

const DETAILS_FIELDS = ["name", "description", "website"] as const;

export async function saveAgencyDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireLister(AGENCY_PATH);
  const values = keepValues(formData, DETAILS_FIELDS);
  const parsed = agencyDetailsSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const deps = getBillingDeps();
  try {
    const tooMany = await limited(POLICIES.agencyManagePerUser, user.id);
    if (tooMany) return { formError: tooMany, values };
    const result = await deps.withTransaction((tx) => updateAgencyDetails(tx, user.id, parsed.data));
    if (result !== "saved") return { formError: "Only an admin of your agency can change its details.", values };
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("details", error);
    return { formError: GENERIC_FAILURE, values };
  }
  refreshAgencyPages();
  return { ok: true, message: "Agency details saved.", values: { ...values, website: parsed.data.website ?? "" } };
}

/* -------------------------------------------------------------------------- */
/* Invites                                                                    */
/* -------------------------------------------------------------------------- */

export interface InviteActionState extends ActionState {
  /** The invite link, shown once so the admin can also share it on WhatsApp. */
  inviteUrl?: string;
}

const INVITE_REFUSALS = {
  not_admin: "Only an admin of your agency can invite agents.",
  already_member: "That person is already part of your agency.",
  too_many: "Your agency has 50 open invites. Revoke some before sending more.",
} as const;

export async function inviteAgentAction(_prev: InviteActionState, formData: FormData): Promise<InviteActionState> {
  const user = await requireLister(AGENCY_PATH);
  const values = keepValues(formData, ["email", "role"]);
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  if (parsed.data.email === user.email.toLowerCase()) return { fieldErrors: { email: "That's your own email address." }, values };

  const deps = getBillingDeps();
  let created: Awaited<ReturnType<typeof createInvite>>;
  try {
    const tooMany = await limited(POLICIES.agencyInvitePerUser, user.id);
    if (tooMany) return { formError: tooMany, values };
    created = await deps.withTransaction((tx) => createInvite(tx, user.id, parsed.data, deps.now()));
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("invite", error);
    return { formError: GENERIC_FAILURE, values };
  }
  if (!created.ok) return { formError: INVITE_REFUSALS[created.reason], values };

  const inviteUrl = `${deps.appUrl}${invitePath(created.token)}`;
  refreshAgencyPages();
  try {
    const email = agencyInviteEmail(
      {
        agencyName: created.agencyName,
        inviterName: created.inviterName,
        role: parsed.data.role,
        expiresOn: formatNairobiDate(created.expiresAt),
      },
      inviteUrl,
    );
    await deps.email({ to: parsed.data.email, ...email });
  } catch (error) {
    logFailure("invite email", error);
    return {
      formError: "Invite saved, but the email didn't send. Copy the link and share it instead.",
      inviteUrl,
      values: { role: parsed.data.role },
    };
  }
  return { ok: true, message: `Invite sent to ${parsed.data.email}. The link works for 7 days.`, inviteUrl, values: { role: parsed.data.role } };
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const user = await requireLister(AGENCY_PATH);
  const parsed = inviteIdSchema.safeParse(formData.get("inviteId"));
  let outcome = "error=failed";
  if (parsed.success) {
    const deps = getBillingDeps();
    try {
      if (await limited(POLICIES.agencyManagePerUser, user.id)) outcome = "error=too_many";
      else {
        const result = await deps.withTransaction((tx) => revokeInvite(tx, user.id, parsed.data, deps.now()));
        outcome = result === "revoked" ? "updated=invite_revoked" : result === "not_admin" ? "error=not_admin" : "error=failed";
      }
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError)) logFailure("revoke", error);
    }
  }
  redirect(`${AGENCY_PATH}?${outcome}`);
}

/** The invite a form refers to: the email link's token, or an id from the account page list. */
function lookupFrom(formData: FormData): InviteLookup | null {
  const token = formData.get("token");
  if (token !== null) return isWellFormedInviteToken(token) ? { kind: "hash", hash: hashInviteToken(token) } : null;
  const id = inviteIdSchema.safeParse(formData.get("inviteId"));
  return id.success ? { kind: "id", id: id.data } : null;
}

/** Where a failed accept or decline returns to: the invite page, or the agency page. */
function returnPath(formData: FormData): string {
  const token = formData.get("token");
  return isWellFormedInviteToken(token) ? invitePath(token) : AGENCY_PATH;
}

export async function acceptInviteAction(formData: FormData): Promise<void> {
  const back = returnPath(formData);
  const user = await requireUser(back);
  const lookup = lookupFrom(formData);
  let target = `${back}?error=failed`;
  if (lookup) {
    const deps = getBillingDeps();
    try {
      if (await limited(POLICIES.agencyInviteAcceptPerUser, user.id)) target = `${back}?error=too_many`;
      else {
        const result = await deps.withTransaction((tx) => acceptInvite(tx, user, lookup, deps.now()));
        target = result.ok ? `${AGENCY_PATH}?${joinOutcome("joined", result.plan)}` : `${back}?error=${result.reason}`;
      }
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError)) logFailure("accept", error);
    }
  }
  refreshAgencyPages();
  redirect(target);
}

export async function declineInviteAction(formData: FormData): Promise<void> {
  const back = returnPath(formData);
  const user = await requireUser(back);
  const lookup = lookupFrom(formData);
  let target = `${back}?error=failed`;
  if (lookup) {
    const deps = getBillingDeps();
    try {
      if (await limited(POLICIES.agencyInviteAcceptPerUser, user.id)) target = `${back}?error=too_many`;
      else {
        const result = await deps.withTransaction((tx) => declineInvite(tx, user, lookup, deps.now()));
        target = result.ok ? `${AGENCY_PATH}?updated=declined` : `${back}?error=${result.reason}`;
      }
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError)) logFailure("decline", error);
    }
  }
  redirect(target);
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export async function setMemberRoleAction(formData: FormData): Promise<void> {
  const user = await requireLister(AGENCY_PATH);
  const parsed = memberRoleChangeSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  let outcome = "error=failed";
  if (parsed.success) {
    const deps = getBillingDeps();
    try {
      if (await limited(POLICIES.agencyManagePerUser, user.id)) outcome = "error=too_many";
      else {
        const result = await deps.withTransaction((tx) => setMemberRole(tx, user.id, parsed.data.userId, parsed.data.role));
        outcome = result.ok ? `updated=role_${parsed.data.role}` : `error=${result.reason}`;
      }
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError)) logFailure("role", error);
    }
  }
  refreshAgencyPages();
  redirect(`${AGENCY_PATH}?${outcome}`);
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await requireLister(AGENCY_PATH);
  const parsed = memberIdSchema.safeParse(formData.get("userId"));
  let outcome = "error=failed";
  if (parsed.success) {
    const deps = getBillingDeps();
    try {
      if (await limited(POLICIES.agencyManagePerUser, user.id)) outcome = "error=too_many";
      else {
        const result = await deps.withTransaction((tx) => removeMember(tx, user.id, parsed.data, deps.now()));
        if (result.ok) {
          outcome = "updated=removed";
          if (result.member.email && result.member.emailVerified) {
            const email = agencyRemovedEmail(
              result.member.name,
              { agencyName: result.agencyName, pausedListings: result.paused },
              `${deps.appUrl}/account/billing/checkout`,
            );
            await deps.email({ to: result.member.email, ...email }).catch((error) => logFailure("removal email", error));
          }
        } else outcome = `error=${result.reason}`;
      }
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError)) logFailure("remove", error);
    }
  }
  refreshAgencyPages();
  redirect(`${AGENCY_PATH}?${outcome}`);
}

export async function leaveAgencyAction(): Promise<void> {
  const user = await requireLister(AGENCY_PATH);
  const deps = getBillingDeps();
  let outcome = "error=failed";
  try {
    if (await limited(POLICIES.agencyManagePerUser, user.id)) outcome = "error=too_many";
    else {
      const result = await deps.withTransaction((tx) => leaveAgency(tx, user.id, deps.now()));
      outcome = result.ok ? `updated=left&paused=${result.paused}` : `error=${result.reason}`;
    }
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("leave", error);
  }
  refreshAgencyPages();
  redirect(`${AGENCY_PATH}?${outcome}`);
}
