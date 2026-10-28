import "server-only";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db";
import { createAuth, type Auth } from "@/lib/auth-config";
import { createTransport } from "@/lib/email/send";
import { getServerEnv } from "@/lib/env";

/** Fails with a clear message naming the variable (never its value). */
function requireAuthSecret(): string {
  const secret = getServerEnv().BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required (32+ characters). Generate one with: openssl rand -base64 48");
  }
  return secret;
}

let auth: Auth | undefined;

/** Lazy so `next build` works without secrets or a database. */
export function getAuth(): Auth {
  if (auth) return auth;
  const env = getServerEnv();
  auth = createAuth({
    db: getDb(),
    secret: requireAuthSecret(),
    baseURL: env.NEXT_PUBLIC_APP_URL,
    production: process.env.NODE_ENV === "production",
    sendEmail: createTransport({ resendApiKey: env.RESEND_API_KEY, emailFrom: env.EMAIL_FROM }),
    // Lets Server Actions set the session cookie.
    plugins: [nextCookies()],
  });
  return auth;
}
