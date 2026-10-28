"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { type ActionState, fieldErrorsFrom, keepValues } from "@/lib/action-state";
import { getAuth } from "@/lib/auth";
import {
  POLICIES,
  RateLimitUnavailableError,
  checkRateLimits,
  rateLimitKey,
  tooManyAttemptsMessage,
} from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from "@/lib/safe-redirect";
import { emailOnlySchema, resetPasswordSchema, signInSchema, signUpSchema } from "@/lib/validation/auth";

const UNAVAILABLE = "Sign-in is temporarily unavailable. Please try again shortly.";
const GENERIC_FAILURE = "Something went wrong. Please try again.";
const BAD_CREDENTIALS = "Email or password is incorrect.";
const RESET_SENT = "If an account exists for that email, we've sent a reset link. It expires in 1 hour.";
const VERIFICATION_SENT = "If that email needs confirming, we've sent a new link. It expires in 1 hour.";
const LINK_EXPIRED = "This link has expired or was already used. Request a new one.";

function apiErrorCode(error: unknown): string | undefined {
  return isAPIError(error) ? (error.body as { code?: string } | undefined)?.code : undefined;
}

/** Runs the limit checks; returns an error state when refused or when limits are unavailable. */
async function limited(checks: Parameters<typeof checkRateLimits>[0]): Promise<string | null> {
  try {
    const result = await checkRateLimits(checks);
    return result.ok ? null : tooManyAttemptsMessage(result.retryAfterSeconds);
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) return UNAVAILABLE;
    throw error;
  }
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = keepValues(formData, ["email"]);
  const next = safeNextPath(formData.get("next"));
  const parsed = signInSchema.safeParse(keepValues(formData, ["email", "password"]));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const ip = await clientIp();
  const refusal = await limited([
    [POLICIES.signInPerEmail, rateLimitKey(parsed.data.email)],
    [POLICIES.signInPerIp, rateLimitKey(ip)],
  ]);
  if (refusal) return { formError: refusal, values };

  try {
    await getAuth().api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password, callbackURL: next, rememberMe: true },
      headers: await headers(),
    });
  } catch (error) {
    const code = apiErrorCode(error);
    if (code === "EMAIL_NOT_VERIFIED") {
      return {
        formError:
          "Confirm your email address first. We've sent you a new link; it expires in 1 hour.",
        values,
      };
    }
    if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_EMAIL" || code === "PASSWORD_TOO_LONG") {
      return { formError: BAD_CREDENTIALS, values };
    }
    console.error("[auth] sign-in failed", code ?? (error instanceof Error ? error.name : "unknown"));
    return { formError: GENERIC_FAILURE, values };
  }
  redirect(next);
}

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = keepValues(formData, ["name", "email", "intent"]);
  const parsed = signUpSchema.safeParse(keepValues(formData, ["name", "email", "password", "intent"]));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const refusal = await limited([[POLICIES.signUpPerIp, rateLimitKey(await clientIp())]]);
  if (refusal) return { formError: refusal, values };

  const next = safeNextPath(formData.get("next"));
  // Listers verify, then land on onboarding; everyone else returns where they came from.
  const callbackURL = parsed.data.intent === "list" ? "/account/onboarding" : next;
  try {
    // Only these three fields reach Better Auth; roles are granted server-side (buyer_tenant).
    // A duplicate email returns the same generic success (requireEmailVerification).
    await getAuth().api.signUpEmail({
      body: { name: parsed.data.name, email: parsed.data.email, password: parsed.data.password, callbackURL },
      headers: await headers(),
    });
  } catch (error) {
    const code = apiErrorCode(error);
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      return { fieldErrors: { password: "Use 10 to 128 characters." }, values };
    }
    console.error("[auth] sign-up failed", code ?? (error instanceof Error ? error.name : "unknown"));
    return { formError: GENERIC_FAILURE, values };
  }
  redirect("/check-email");
}

export async function forgotPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = keepValues(formData, ["email"]);
  const parsed = emailOnlySchema.safeParse(keepValues(formData, ["email"]));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const refusal = await limited([
    [POLICIES.resetPerEmail, rateLimitKey(parsed.data.email)],
    [POLICIES.resetPerIp, rateLimitKey(await clientIp())],
  ]);
  if (refusal) return { formError: refusal, values };

  try {
    await getAuth().api.requestPasswordReset({
      body: { email: parsed.data.email, redirectTo: "/reset-password" },
      headers: await headers(),
    });
  } catch (error) {
    // Never surfaced: the response must be identical whether or not the account exists.
    console.error("[auth] reset request failed", apiErrorCode(error) ?? (error instanceof Error ? error.name : "unknown"));
  }
  return { ok: true, message: RESET_SENT };
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse(keepValues(formData, ["token", "password", "confirmPassword"]));
  if (!parsed.success) {
    const fieldErrors = fieldErrorsFrom(parsed.error);
    return fieldErrors.token ? { formError: LINK_EXPIRED } : { fieldErrors };
  }
  try {
    await getAuth().api.resetPassword({
      body: { token: parsed.data.token, newPassword: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    const code = apiErrorCode(error);
    if (code === "INVALID_TOKEN") return { formError: LINK_EXPIRED };
    console.error("[auth] reset failed", code ?? (error instanceof Error ? error.name : "unknown"));
    return { formError: GENERIC_FAILURE };
  }
  redirect("/sign-in?reset=1");
}

export async function resendVerificationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = keepValues(formData, ["email"]);
  const parsed = emailOnlySchema.safeParse(keepValues(formData, ["email"]));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const refusal = await limited([[POLICIES.resendPerEmail, rateLimitKey(parsed.data.email)]]);
  if (refusal) return { formError: refusal, values };

  try {
    await getAuth().api.sendVerificationEmail({
      body: { email: parsed.data.email, callbackURL: DEFAULT_SIGNED_IN_PATH },
      headers: await headers(),
    });
  } catch (error) {
    console.error("[auth] resend verification failed", apiErrorCode(error) ?? (error instanceof Error ? error.name : "unknown"));
  }
  return { ok: true, message: VERIFICATION_SENT };
}

export async function signOutAction(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (error) {
    console.error("[auth] sign-out failed", error instanceof Error ? error.name : "unknown");
  }
  redirect("/");
}
