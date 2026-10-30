"use server";

import { redirect } from "next/navigation";
import {
  approveListing,
  dismissReport,
  rejectListing,
  takeDownForReport,
  type DecisionResult,
} from "@/db/queries/moderation";
import { withTransaction } from "@/db/tx";
import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/session";
import { decisionReasonSchema } from "@/lib/validation/engagement";

/**
 * Moderation decisions (prompt S8 decisions 3 and 4). Platform admins only: anyone else gets a
 * 404 from `requireRole`. The admin id comes from the session; each decision runs in one
 * transaction with its log entry.
 */

const MODERATOR = ["platform_admin"] as const;
const GENERIC_FAILURE = "Something went wrong. Please try again.";

const REFUSALS: Record<Extract<DecisionResult, { ok: false }>["reason"], string> = {
  not_found: "We couldn't find that item.",
  conflict: "Someone already decided this. Reload to see the latest.",
  plan_inactive: "The lister's plan isn't active, so this listing can't go live yet. It stays in the queue.",
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function decide(action: string, run: () => Promise<DecisionResult>): Promise<DecisionResult | "failed"> {
  try {
    return await run();
  } catch (error) {
    console.error(`[moderation] ${action} failed`, error instanceof Error ? error.name : "unknown");
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
