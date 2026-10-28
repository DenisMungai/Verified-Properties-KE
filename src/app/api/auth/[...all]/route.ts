import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

/**
 * GET only: email verification links, password-reset link callbacks and session reads.
 * Sign-in, sign-up, resets and account changes go through rate-limited Server Actions, so the
 * POST endpoints are deliberately not exposed (405).
 */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}
