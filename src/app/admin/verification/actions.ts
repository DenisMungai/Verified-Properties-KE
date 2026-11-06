"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/session";
import { decisionReasonSchema } from "@/lib/validation/engagement";
import { getDecisionDeps, notifyLister } from "@/lib/verification/app-deps";
import {
  approveRequest,
  rejectRequest,
  requestChanges,
  suspendRequest,
  type DecisionResult,
} from "@/lib/verification/decisions";
import { REVIEW_CHECKLIST } from "@/lib/verification/rules";

/**
 * Verification decisions (prompt S12 decision 8). Platform admins only: anyone else gets a 404 from
 * `requireRole`. The admin id comes from the session, the request id from the form; the decision
 * module locks the row and checks its status. The lister email goes out after the commit.
 */

const REVIEWER = ["platform_admin"] as const;
const QUEUE = "/admin/verification";
const GENERIC_FAILURE = "Something went wrong. Please try again.";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function run(action: string, fn: () => Promise<DecisionResult>): Promise<DecisionResult | "failed"> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[verification] ${action} failed`, error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}

function refusal(result: DecisionResult | "failed"): string {
  return result === "failed" ? GENERIC_FAILURE : result.ok ? "" : result.message;
}

export async function approveVerificationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(REVIEWER, QUEUE);
  const id = formText(formData, "requestId");
  // The checklist is enforced here too, not only by the disabled button.
  if (!REVIEW_CHECKLIST.every((item) => formData.get(item.name) === "on")) {
    return { formError: "Confirm every item on the review checklist before approving." };
  }
  const result = await run("approve", () => approveRequest(getDecisionDeps(), admin.id, id));
  if (result !== "failed" && result.ok) {
    await notifyLister(result.listerUserId, "approved");
    redirect(`${QUEUE}?notice=approved`);
  }
  return { formError: refusal(result) };
}

type ReasonDecision = (deps: ReturnType<typeof getDecisionDeps>, adminId: string, id: string, reason: string) => Promise<DecisionResult>;

async function withReason(
  formData: FormData,
  action: "request changes" | "reject" | "suspend",
  decide: ReasonDecision,
  done: (result: Extract<DecisionResult, { ok: true }>, reason: string) => Promise<string>,
): Promise<ActionState> {
  const admin = await requireRole(REVIEWER, QUEUE);
  const id = formText(formData, "requestId");
  const values = { reason: formText(formData, "reason") };
  const reason = decisionReasonSchema.safeParse(values.reason);
  if (!reason.success) return { fieldErrors: { reason: reason.error.issues[0]?.message ?? "Add a reason." }, values };
  const result = await run(action, () => decide(getDecisionDeps(), admin.id, id, reason.data));
  if (result !== "failed" && result.ok) redirect(`${QUEUE}?notice=${await done(result, reason.data)}`);
  return { formError: refusal(result), values };
}

export async function requestChangesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withReason(formData, "request changes", requestChanges, async (result, reason) => {
    await notifyLister(result.listerUserId, "changes_requested", { reason });
    return "changes_requested";
  });
}

export async function rejectVerificationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withReason(formData, "reject", rejectRequest, async (result, reason) => {
    if (result.rereview) {
      await notifyLister(result.listerUserId, "rereview_rejected", { reason });
      return "rejected_rereview";
    }
    const credit = result.credit;
    const creditNote =
      credit?.kind === "credited"
        ? `${credit.days} days were added to your listing plan.`
        : "Our billing team will contact you about a refund.";
    await notifyLister(result.listerUserId, "rejected", { reason, creditNote });
    return credit?.kind === "credited" ? "rejected" : "rejected_refund";
  });
}

export async function suspendVerificationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withReason(formData, "suspend", suspendRequest, async (result, reason) => {
    await notifyLister(result.listerUserId, "suspended", { reason });
    return "suspended";
  });
}
