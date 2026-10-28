"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { saveListerProfile } from "@/db/queries/lister-profiles";
import { withTransaction } from "@/db/tx";
import { type ActionState, fieldErrorsFrom, keepValues } from "@/lib/action-state";
import { getAuth } from "@/lib/auth";
import {
  POLICIES,
  RateLimitUnavailableError,
  checkRateLimits,
  rateLimitKey,
  tooManyAttemptsMessage,
} from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { accountNameSchema, changePasswordSchema } from "@/lib/validation/auth";
import { listerProfileSchema } from "@/lib/validation/profile";

const GENERIC_FAILURE = "Something went wrong. Please try again.";
const PROFILE_FIELDS = ["listerType", "displayName", "phone", "publicEmail", "bio"] as const;

function apiErrorCode(error: unknown): string | undefined {
  return isAPIError(error) ? (error.body as { code?: string } | undefined)?.code : undefined;
}

/** Onboarding and "Listing profile" share this action; `redirectTo` decides where success lands. */
export async function saveListerProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/account/onboarding");
  const values = keepValues(formData, PROFILE_FIELDS);
  // Only the five profile fields are read; role, agency or verification fields are never parsed.
  const parsed = listerProfileSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  try {
    await withTransaction((tx) => saveListerProfile(tx, user.id, parsed.data));
  } catch (error) {
    console.error("[account] profile save failed", error instanceof Error ? error.name : "unknown");
    return { formError: GENERIC_FAILURE, values };
  }

  if (formData.get("redirectTo") === "overview") redirect("/account?welcome=lister");
  return { ok: true, message: "Listing profile saved.", values };
}

export async function updateNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/account/settings");
  const values = keepValues(formData, ["name"]);
  const parsed = accountNameSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  try {
    await getAuth().api.updateUser({ body: { name: parsed.data.name }, headers: await headers() });
  } catch (error) {
    console.error("[account] name update failed", apiErrorCode(error) ?? "unknown");
    return { formError: GENERIC_FAILURE, values };
  }
  return { ok: true, message: "Name updated.", values };
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/account/settings");
  const parsed = changePasswordSchema.safeParse(
    keepValues(formData, ["currentPassword", "newPassword", "confirmPassword"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    const limit = await checkRateLimits([[POLICIES.passwordChangePerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { formError: tooManyAttemptsMessage(limit.retryAfterSeconds) };
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) return { formError: "Password changes are temporarily unavailable." };
    throw error;
  }

  try {
    await getAuth().api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (error) {
    const code = apiErrorCode(error);
    if (code === "INVALID_PASSWORD") return { fieldErrors: { currentPassword: "Current password is incorrect." } };
    console.error("[account] password change failed", code ?? "unknown");
    return { formError: GENERIC_FAILURE };
  }
  return { ok: true, message: "Password changed. Other devices have been signed out." };
}

export async function signOutEverywhereAction(): Promise<void> {
  await requireUser("/account/settings");
  try {
    await getAuth().api.revokeSessions({ headers: await headers() });
  } catch (error) {
    console.error("[account] revoke sessions failed", apiErrorCode(error) ?? "unknown");
  }
  redirect("/sign-in");
}
