"use server";

import { redirect } from "next/navigation";
import {
  approveListing,
  dismissReport,
  rejectListing,
  takeDownForReport,
  type DecisionResult,
} from "@/db/queries/moderation";
import { dismissMessageReport, removeReportedMessage, type MessageDecisionResult } from "@/db/queries/message-moderation";
import { getDb } from "@/db";
import { closeDataRequest, type CloseResult } from "@/db/queries/data-requests";
import { withTransaction } from "@/db/tx";
import { type ActionState, fieldErrorsFrom, GENERIC_FAILURE } from "@/lib/action-state";
import { invalidatePublicListings } from "@/lib/cache/public-listings";
import { errorName } from "@/lib/log";
import { requireRole } from "@/lib/session";
import { closeDataRequestSchema } from "@/lib/validation/data-request";
import { decisionReasonSchema } from "@/lib/validation/engagement";

/**
 * Moderation decisions (prompt S8 decisions 3 and 4). Platform admins only: anyone else gets a
 * 404 from `requireRole`. The admin id comes from the session; each decision runs in one
 * transaction with its log entry.
 */

const MODERATOR = ["platform_admin"] as const;

const REFUSALS: Record<Extract<DecisionResult, { ok: false }>["reason"], string> = {
  not_found: "We couldn't find that item.",
  conflict: "Someone already decided this. Reload to see the latest.",
  plan_inactive: "The lister's plan isn't active, so this listing can't go live yet. It stays in the queue.",
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Runs one listing decision; a successful one can publish or hide a listing, so the public cache is cleared. */
async function decide(action: string, run: () => Promise<DecisionResult>): Promise<DecisionResult | "failed"> {
  try {
    const result = await run();
    if (result.ok) invalidatePublicListings();
    return result;
  } catch (error) {
    console.error(`[moderation] ${action} failed`, errorName(error));
    return "failed";
  }
}

function refusal(result: DecisionResult | "failed"): string {
  return result === "failed" ? GENERIC_FAILURE : result.ok ? "" : REFUSALS[result.reason];
}

export async function approveListingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(MODERATOR, "/admin/listings");
  const id = formText(formData, "listingId");
  const result = await decide("approve", () => withTransaction((tx) => approveListing(tx, admin.id, id)));
  if (result !== "failed" && result.ok) redirect("/admin/listings?notice=approved");
  return { formError: refusal(result) };
}

export async function rejectListingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(MODERATOR, "/admin/listings");
  const id = formText(formData, "listingId");
  const values = { reason: formText(formData, "reason") };
  const reason = decisionReasonSchema.safeParse(values.reason);
  if (!reason.success) return { fieldErrors: { reason: reason.error.issues[0]?.message ?? "Add a reason." }, values };
  const result = await decide("reject", () => withTransaction((tx) => rejectListing(tx, admin.id, id, reason.data)));
  if (result !== "failed" && result.ok) redirect("/admin/listings?notice=rejected");
  return { formError: refusal(result), values };
}

export async function dismissReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(MODERATOR, "/admin/reports");
  const id = formText(formData, "reportId");
  const result = await decide("dismiss report", () => withTransaction((tx) => dismissReport(tx, admin.id, id)));
  if (result !== "failed" && result.ok) redirect("/admin/reports?notice=dismissed");
  return { formError: refusal(result) };
}

export async function takeDownAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(MODERATOR, "/admin/reports");
  const id = formText(formData, "reportId");
  const values = { reason: formText(formData, "reason") };
  const reason = decisionReasonSchema.safeParse(values.reason);
  if (!reason.success) return { fieldErrors: { reason: reason.error.issues[0]?.message ?? "Add a reason." }, values };
  const result = await decide("take down", () => withTransaction((tx) => takeDownForReport(tx, admin.id, id, reason.data)));
  if (result !== "failed" && result.ok) redirect("/admin/reports?notice=taken_down");
  return { formError: refusal(result), values };
}

/* -------------------------------------------------------------------------- */
/* Reported messages (prompt S15 decision 13)                                 */
/* -------------------------------------------------------------------------- */

const MESSAGE_REFUSALS: Record<Extract<MessageDecisionResult, { ok: false }>["reason"], string> = {
  not_found: "We couldn't find that report.",
  conflict: "Someone already decided this. Reload to see the latest.",
};

async function decideMessage(action: string, run: () => Promise<MessageDecisionResult>): Promise<MessageDecisionResult | "failed"> {
  try {
    return await run();
  } catch (error) {
    console.error(`[moderation] ${action} failed`, errorName(error));
    return "failed";
  }
}

function messageRefusal(result: MessageDecisionResult | "failed"): string {
  return result === "failed" ? GENERIC_FAILURE : result.ok ? "" : MESSAGE_REFUSALS[result.reason];
}

export async function dismissMessageReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(MODERATOR, "/admin/reports");
  const id = formText(formData, "reportId");
  const result = await decideMessage("dismiss message report", () => withTransaction((tx) => dismissMessageReport(tx, admin.id, id)));
  if (result !== "failed" && result.ok) redirect("/admin/reports?notice=message_dismissed");
  return { formError: messageRefusal(result) };
}

/** Remove the reported message; with `close=1` also close the conversation. */
export async function removeMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(MODERATOR, "/admin/reports");
  const id = formText(formData, "reportId");
  const close = formText(formData, "close") === "1";
  const values = { reason: formText(formData, "reason") };
  const reason = decisionReasonSchema.safeParse(values.reason);
  if (!reason.success) return { fieldErrors: { reason: reason.error.issues[0]?.message ?? "Add a reason." }, values };
  const result = await decideMessage("remove message", () =>
    withTransaction((tx) => removeReportedMessage(tx, admin.id, id, reason.data, close)),
  );
  if (result !== "failed" && result.ok) redirect(`/admin/reports?notice=${close ? "conversation_closed" : "message_removed"}`);
  return { formError: messageRefusal(result), values };
}

/* -------------------------------------------------------------------------- */
/* Data requests (prompt S20 decision 7)                                      */
/* -------------------------------------------------------------------------- */

const CLOSE_REFUSALS: Record<Extract<CloseResult, { ok: false }>["reason"], string> = {
  not_found: "We couldn't find that request.",
  already_closed: "This request is already closed. Reload to see the latest.",
};

/** Close a privacy or billing request with the note the user sees. */
export async function closeDataRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(MODERATOR, "/admin/data-requests");
  const values = { requestId: formText(formData, "requestId"), note: formText(formData, "note") };
  const parsed = closeDataRequestSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  let result: CloseResult;
  try {
    result = await closeDataRequest(getDb(), admin.id, parsed.data.requestId, parsed.data.note);
  } catch (error) {
    console.error("[data-request] close failed", errorName(error));
    return { formError: GENERIC_FAILURE, values };
  }
  if (!result.ok) return { formError: CLOSE_REFUSALS[result.reason], values };
  redirect("/admin/data-requests?notice=closed");
}
