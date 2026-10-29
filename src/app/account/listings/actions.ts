"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  createDraft,
  deleteDraft,
  submitListing,
  transitionListing,
  unpauseListing,
  updateListing,
  type ListingResult,
} from "@/db/queries/listings";
import { withTransaction } from "@/db/tx";
import type { ActionState } from "@/lib/action-state";
import { PUBLISH_BLOCK_MESSAGES } from "@/lib/billing/entitlements";
import { LISTER_TRANSITION_TARGETS, type ListerTransitionTarget } from "@/lib/listings/workflow";
import {
  POLICIES,
  RateLimitUnavailableError,
  checkRateLimits,
  rateLimitKey,
  tooManyAttemptsMessage,
} from "@/lib/rate-limit";
import {
  basicsFormValues,
  detailsFormValues,
  detailsValuesForState,
  parseBasicsStep,
  parseDetailsStep,
} from "@/lib/validation/listing";
import { requireLister } from "./guard";
import { deleteStoredPhotos } from "./stored-photos";

/**
 * Listing Server Actions (prompt S3). Each one checks the session and lister role, validates with
 * Zod, and calls one query that re-checks ownership (`manageableBy`). The listing id from the form
 * is never trusted on its own. Logs carry no listing content or personal data.
 */

const GENERIC_FAILURE = "Something went wrong. Please try again.";

const RESULT_MESSAGES: Record<"not_found" | "not_allowed" | "conflict", string> = {
  not_found: "We couldn't find that listing.",
  not_allowed: "That change isn't available for this listing right now.",
  conflict: "This listing changed in the meantime. Reload the page and try again.",
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failureMessage(result: Extract<ListingResult, { ok: false }>): string {
  switch (result.reason) {
    case "entitlement":
      return PUBLISH_BLOCK_MESSAGES[result.entitlement.reason];
    case "invalid":
      return "Some details are missing. Fix the items listed below, then submit again.";
    default:
      return RESULT_MESSAGES[result.reason];
  }
}

function logFailure(action: string, error: unknown): void {
  console.error(`[listings] ${action} failed`, error instanceof Error ? error.name : "unknown");
}

function savedMessage(result: Extract<ListingResult, { ok: true }>): string {
  if (result.returnedToReview && result.status === "draft") {
    return "Saved as a draft. You changed key details, so submit it again when you're ready.";
  }
  if (result.returnedToReview) return "Saved. You changed key details, so the listing is back in review.";
  return result.status === "draft" ? "Draft saved." : "Changes saved.";
}

/** Basics step: creates the draft (rate limited) or updates it. */
export async function saveBasicsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const listingId = formText(formData, "listingId");
  const user = await requireLister(listingId ? `/account/listings/${listingId}/basics` : "/account/listings/new");
  const intent = formText(formData, "intent") === "continue" ? "continue" : "draft";
  const values = basicsFormValues(formData);
  const parsed = parseBasicsStep(values);
  if (!parsed.success) return { fieldErrors: parsed.errors, values };

  let id = listingId;
  let message: string | undefined;
  try {
    if (!id) {
      const limit = await checkRateLimits([[POLICIES.listingCreatePerUser, rateLimitKey(user.id)]]);
      if (!limit.ok) return { formError: tooManyAttemptsMessage(limit.retryAfterSeconds), values };
      id = (await createDraft(getDb(), user.id, parsed.data)).id;
    } else {
      const result = await updateListing(getDb(), user.id, id, parsed.data);
      if (!result.ok) return { formError: failureMessage(result), values };
      message = savedMessage(result);
    }
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) return { formError: GENERIC_FAILURE, values };
    logFailure("save basics", error);
    return { formError: GENERIC_FAILURE, values };
  }

  if (intent === "continue") redirect(`/account/listings/${id}/details`);
  if (!listingId) redirect(`/account/listings/${id}/basics?saved=1`);
  return { ok: true, message, values };
}

/** Details step. */
export async function saveDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const listingId = formText(formData, "listingId");
  const user = await requireLister(`/account/listings/${listingId}/details`);
  const intent = formText(formData, "intent") === "continue" ? "continue" : "draft";
  const raw = detailsFormValues(formData);
  const values = detailsValuesForState(raw);
  const parsed = parseDetailsStep(raw);
  if (!parsed.success) return { fieldErrors: parsed.errors, values };

  let message: string;
  try {
    const result = await updateListing(getDb(), user.id, listingId, parsed.data);
    if (!result.ok) return { formError: failureMessage(result), values };
    message = savedMessage(result);
  } catch (error) {
    logFailure("save details", error);
    return { formError: GENERIC_FAILURE, values };
  }

  if (intent === "continue") redirect(`/account/listings/${listingId}/photos`);
  return { ok: true, message, values };
}

/** Submit: entitlement and verified status are decided on the server, inside one transaction. */
export async function submitListingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const listingId = formText(formData, "listingId");
  const user = await requireLister(`/account/listings/${listingId}/preview`);
  let result: ListingResult;
  try {
    result = await withTransaction((tx) => submitListing(tx, user.id, listingId));
  } catch (error) {
    logFailure("submit", error);
    return { formError: GENERIC_FAILURE };
  }
  if (!result.ok) return { formError: failureMessage(result) };
  redirect(`/account/listings?submitted=${result.status}`);
}

const STATUS_INTENTS = [...LISTER_TRANSITION_TARGETS, "unpause", "delete"] as const;
type StatusIntent = (typeof STATUS_INTENTS)[number];

function isStatusIntent(value: string): value is StatusIntent {
  return (STATUS_INTENTS as readonly string[]).includes(value);
}

/**
 * Status buttons on My listings and Preview. Redirects back to My listings with the outcome in
 * the query string (`updated=` or `error=`), so it works without JavaScript.
 */
export async function changeListingStatusAction(formData: FormData): Promise<void> {
  const listingId = formText(formData, "listingId");
  const intent = formText(formData, "intent");
  const user = await requireLister("/account/listings");
  if (!isStatusIntent(intent)) redirect("/account/listings?error=not_allowed");

  let result: ListingResult;
  try {
    if (intent === "unpause") {
      result = await withTransaction((tx) => unpauseListing(tx, user.id, listingId));
    } else if (intent === "delete") {
      result = await deleteDraft(getDb(), user.id, listingId);
      if (result.ok) await deleteStoredPhotos(result.photoKeys ?? []);
    } else {
      result = await transitionListing(getDb(), user.id, listingId, intent satisfies ListerTransitionTarget);
    }
  } catch (error) {
    logFailure(`status ${intent}`, error);
    redirect("/account/listings?error=failed");
  }

  if (!result.ok) {
    const code = result.reason === "entitlement" ? result.entitlement.reason : result.reason;
    redirect(`/account/listings?error=${code}`);
  }
  redirect(`/account/listings?updated=${intent === "unpause" ? "published" : intent === "delete" ? "deleted" : intent}`);
}
