"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { reportMessage, type MessageReportResult } from "@/db/queries/message-moderation";
import { blockUser, sendMessage, unblockUser, type SendResult } from "@/db/queries/messaging";
import { withTransaction } from "@/db/tx";
import { type ActionState, fieldErrorsFrom, GENERIC_FAILURE, keepValues } from "@/lib/action-state";
import { errorName } from "@/lib/log";
import { POLICIES, RateLimitUnavailableError, checkRateLimits, rateLimitKey, tooManyAttemptsMessage, type RateLimitPolicy } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { messageReportSchema, messageSchema } from "@/lib/validation/messaging";

/**
 * Messaging actions (prompt S15 decisions 9, 11 and 12). Each one reads the session, validates
 * ids and input, applies its rate limit and calls one query scoped to the conversation's
 * participants. The other person is always derived on the server. Logs carry outcomes only.
 */

const SIGN_IN_FIRST = "Sign in to continue.";
const NOT_FOUND = "We couldn't find that conversation.";
const id = z.uuid();

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function logFailure(action: string, error: unknown): void {
  if (error instanceof RateLimitUnavailableError) return;
  console.error(`[messaging] ${action} failed`, errorName(error));
}

async function signedInUser() {
  const user = await getCurrentUser();
  return user?.emailVerified ? user : null;
}

/** Null when allowed, or the message to show. */
async function limited(policy: RateLimitPolicy, userId: string): Promise<string | null> {
  const limit = await checkRateLimits([[policy, rateLimitKey(userId)]]);
  return limit.ok ? null : tooManyAttemptsMessage(limit.retryAfterSeconds);
}

/* -------------------------------------------------------------------------- */
/* Send                                                                       */
/* -------------------------------------------------------------------------- */

const SEND_REFUSALS: Record<Exclude<Extract<SendResult, { ok: false }>["reason"], "duplicate">, string> = {
  not_found: NOT_FOUND,
  closed: "This conversation was closed by VerifiedPropertiesKE.",
  blocked: "You can't reply to this conversation.",
};

export async function sendMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = keepValues(formData, ["body"]);
  const user = await signedInUser();
  if (!user) return { formError: SIGN_IN_FIRST, values };
  const conversationId = id.safeParse(formText(formData, "conversationId"));
  if (!conversationId.success) return { formError: NOT_FOUND, values };
  const body = messageSchema.safeParse(values.body ?? "");
  if (!body.success) return { fieldErrors: { body: body.error.issues[0]?.message ?? "Write a message." }, values };

  let result: SendResult;
  try {
    const refusal = await limited(POLICIES.messagePerUser, user.id);
    if (refusal) return { formError: refusal, values };
    result = await withTransaction((tx) => sendMessage(tx, user.id, conversationId.data, body.data));
  } catch (error) {
    logFailure("send", error);
    return { formError: GENERIC_FAILURE, values };
  }
  // A double send: the first one landed, so this one succeeds quietly.
  if (!result.ok && result.reason !== "duplicate") return { formError: SEND_REFUSALS[result.reason], values };
  refresh();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Block                                                                      */
/* -------------------------------------------------------------------------- */

async function changeBlock(formData: FormData, run: typeof blockUser, done: string): Promise<ActionState> {
  const user = await signedInUser();
  if (!user) return { formError: SIGN_IN_FIRST };
  const conversationId = id.safeParse(formText(formData, "conversationId"));
  if (!conversationId.success) return { formError: NOT_FOUND };
  try {
    const refusal = await limited(POLICIES.blockPerUser, user.id);
    if (refusal) return { formError: refusal };
    const result = await run(getDb(), user.id, conversationId.data);
    if (!result.ok) return { formError: NOT_FOUND };
  } catch (error) {
    logFailure("block change", error);
    return { formError: GENERIC_FAILURE };
  }
  refresh();
  return { ok: true, message: done };
}

export async function blockUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return changeBlock(formData, blockUser, "Blocked. Neither of you can send messages now.");
}

export async function unblockUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return changeBlock(formData, unblockUser, "Unblocked. You can message each other again.");
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

const REPORT_REFUSALS: Record<Extract<MessageReportResult, { ok: false }>["reason"], string> = {
  not_found: "You can only report messages sent to you.",
  already_reported: "You've already reported this message. Our team will review it.",
};

export async function reportMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = keepValues(formData, ["reason", "details"]);
  const user = await signedInUser();
  if (!user) return { formError: SIGN_IN_FIRST, values };
  const messageId = id.safeParse(formText(formData, "messageId"));
  if (!messageId.success) return { formError: REPORT_REFUSALS.not_found, values };
  const parsed = messageReportSchema.safeParse({ ...values, details: values.details ?? "", block: formData.get("block") === "on" });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  let result: MessageReportResult;
  try {
    const refusal = await limited(POLICIES.messageReportPerUser, user.id);
    if (refusal) return { formError: refusal, values };
    result = await withTransaction((tx) => reportMessage(tx, user.id, messageId.data, parsed.data));
  } catch (error) {
    logFailure("report", error);
    return { formError: GENERIC_FAILURE, values };
  }
  if (!result.ok) {
    return result.reason === "already_reported"
      ? { ok: true, message: REPORT_REFUSALS.already_reported }
      : { formError: REPORT_REFUSALS[result.reason], values };
  }
  refresh();
  return {
    ok: true,
    message: parsed.data.block ? "Thanks. Our team will review this message, and you've blocked this person." : "Thanks. Our team will review this message.",
  };
}
