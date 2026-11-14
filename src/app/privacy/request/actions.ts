"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { createDataRequest } from "@/db/queries/data-requests";
import { fieldErrorsFrom, keepValues, type ActionState } from "@/lib/action-state";
import { DATA_REQUEST_PATH, requestReference, responseTargetFor } from "@/lib/legal";
import { errorName } from "@/lib/log";
import { POLICIES, RateLimitUnavailableError, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { DATA_REQUEST_FIELDS, dataRequestSchema } from "@/lib/validation/data-request";

/**
 * Privacy and billing requests (prompt S20 decision 7). Signed-in, verified users only; the user
 * comes from the session, never the form. Rate-limited per user, failing closed. Logs carry the
 * error name only, never the request text.
 */
export async function createDataRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(DATA_REQUEST_PATH);
  const values = keepValues(formData, DATA_REQUEST_FIELDS);
  const parsed = dataRequestSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  let id: string;
  try {
    const limit = await checkRateLimits([[POLICIES.dataRequestPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { formError: tooManyAttemptsMessage(limit.retryAfterSeconds), values };
    ({ id } = await createDataRequest(getDb(), user.id, parsed.data));
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) {
      console.error("[data-request] create failed", errorName(error));
    }
    return { formError: "Something went wrong. Please try again.", values };
  }
  refresh();
  return {
    ok: true,
    message: `Request ${requestReference(id)} received. We'll reply within ${responseTargetFor(parsed.data.kind)} by email.`,
  };
}
