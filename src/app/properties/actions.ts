"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { setFavorite } from "@/db/queries/favorites";
import { createInquiry, type InquiryResult } from "@/db/queries/inquiries";
import { createReport, type ReportResult } from "@/db/queries/reports";
import { withTransaction } from "@/db/tx";
import { fieldErrorsFrom, keepValues, type ActionState } from "@/lib/action-state";
import { POLICIES, RateLimitUnavailableError, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { INQUIRY_FIELDS, inquirySchema, reportSchema } from "@/lib/validation/engagement";

/**
 * Buyer engagement on a listing (prompt S8 decisions 2, 5 and 6). Each action reads the session,
 * validates ids and input, applies its rate limit and calls one query that re-checks the listing
 * is published and not the user's own. Logs carry ids only, never message text or contact details.
 */

const GENERIC_FAILURE = "Something went wrong. Please try again.";
const SIGN_IN_FIRST = "Sign in to continue.";
const listingId = z.uuid();

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function logFailure(action: string, error: unknown): void {
  console.error(`[engagement] ${action} failed`, error instanceof Error ? error.name : "unknown");
}

async function signedInUser() {
  const user = await getCurrentUser();
  return user?.emailVerified ? user : null;
}

/* -------------------------------------------------------------------------- */
/* Save                                                                       */
/* -------------------------------------------------------------------------- */

export interface SaveState {
  saved: boolean;
  error?: string;
}

/** Heart button. `saved` in the form is the state wanted; the server decides what happens. */
export async function toggleSaveAction(prev: SaveState, formData: FormData): Promise<SaveState> {
  const user = await signedInUser();
  if (!user) return { saved: prev.saved, error: SIGN_IN_FIRST };
  const id = listingId.safeParse(formText(formData, "listingId"));
  if (!id.success) return { saved: prev.saved, error: "That listing is no longer available." };
  const wanted = formText(formData, "saved") === "true";

  try {
    const limit = await checkRateLimits([[POLICIES.favoritePerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { saved: prev.saved, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };
    const result = await setFavorite(getDb(), user.id, id.data, wanted);
    if (!result.ok) return { saved: false, error: "That listing is no longer available." };
    // The saved page lists favourites, so it re-renders without the removed one.
    if (formText(formData, "refresh") === "1") refresh();
    return { saved: result.saved };
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("save", error);
    return { saved: prev.saved, error: GENERIC_FAILURE };
  }
}

/* -------------------------------------------------------------------------- */
/* Inquiry                                                                    */
/* -------------------------------------------------------------------------- */

const INQUIRY_REFUSALS: Record<Extract<InquiryResult, { ok: false }>["reason"], string> = {
  unavailable: "This listing is no longer available.",
  own_listing: "This is your own listing.",
  too_many: "You've already sent 3 messages about this property today. Please wait for a reply.",
  duplicate: "You already sent this exact message. The lister has it.",
};

export async function sendInquiryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = keepValues(formData, INQUIRY_FIELDS);
  const user = await signedInUser();
  if (!user) return { formError: SIGN_IN_FIRST, values };
  const id = listingId.safeParse(formText(formData, "listingId"));
  if (!id.success) return { formError: INQUIRY_REFUSALS.unavailable, values };

  const parsed = inquirySchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  let result: InquiryResult;
  try {
    const limit = await checkRateLimits([[POLICIES.inquiryPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { formError: tooManyAttemptsMessage(limit.retryAfterSeconds), values };
    result = await withTransaction((tx) => createInquiry(tx, user.id, id.data, parsed.data));
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("inquiry", error);
    return { formError: GENERIC_FAILURE, values };
  }
  if (!result.ok) return { formError: INQUIRY_REFUSALS[result.reason], values };

  // Re-render the listing so the lister panel shows the contact details this inquiry unlocked.
  refresh();
  return { ok: true, message: "Message sent. The lister will reply to you directly." };
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

const REPORT_REFUSALS: Record<Extract<ReportResult, { ok: false }>["reason"], string> = {
  unavailable: "This listing is no longer available.",
  own_listing: "You can't report your own listing.",
  already_reported: "You've already reported this listing. Our team will review it.",
};

export async function reportListingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = keepValues(formData, ["reason", "details"]);
  const user = await signedInUser();
  if (!user) return { formError: SIGN_IN_FIRST, values };
  const id = listingId.safeParse(formText(formData, "listingId"));
  if (!id.success) return { formError: REPORT_REFUSALS.unavailable, values };

  const parsed = reportSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  let result: ReportResult;
  try {
    const limit = await checkRateLimits([[POLICIES.reportPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { formError: tooManyAttemptsMessage(limit.retryAfterSeconds), values };
    result = await createReport(getDb(), user.id, id.data, parsed.data);
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("report", error);
    return { formError: GENERIC_FAILURE, values };
  }
  if (!result.ok) {
    return result.reason === "already_reported"
      ? { ok: true, message: REPORT_REFUSALS.already_reported }
      : { formError: REPORT_REFUSALS[result.reason], values };
  }
  return { ok: true, message: "Thanks. Our team will review this report." };
}
