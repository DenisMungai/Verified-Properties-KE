import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { grantRoles } from "@/db/queries/roles";
import type { EmailTransport } from "@/lib/email/send";
import { maskEmail } from "@/lib/email/send";
import { passwordResetEmail, verificationEmail } from "@/lib/email/templates";
import { SIGN_UP_ROLE } from "@/lib/roles";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/validation/auth";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const EMAIL_LINK_TTL_SECONDS = 60 * 60;

/**
 * Better Auth HTTP endpoints we never serve. The route handler exports GET only (email
 * verification and reset-link callbacks); every mutation goes through our rate-limited Server
 * Actions calling `auth.api.*` on the server, which bypasses the HTTP router.
 */
const DISABLED_HTTP_PATHS = [
  "/list-sessions",
  "/list-accounts",
  "/account-info",
  "/delete-user/callback",
];

export interface CreateAuthOptions {
  db: DbExecutor;
  secret: string;
  baseURL: string;
  sendEmail: EmailTransport;
  production: boolean;
  plugins?: BetterAuthPlugin[];
}

/**
 * Builds the Better Auth instance. Kept free of Next.js and `server-only` imports so integration
 * tests and scripts can construct it against a test branch; the app uses `src/lib/auth.ts`.
 */
export function createAuth({ db, secret, baseURL, sendEmail, production, plugins = [] }: CreateAuthOptions) {
  /** Fire-and-forget: response timing must not reveal whether an account exists. */
  function deliver(kind: string, to: string, content: Parameters<EmailTransport>[0]) {
    void sendEmail(content).catch((error: unknown) => {
      console.error(`[auth] ${kind} email to ${maskEmail(to)} failed:`, error instanceof Error ? error.message : "unknown");
    });
  }

  return betterAuth({
    appName: "VerifiedPropertiesKE",
    secret,
    baseURL,
    trustedOrigins: [new URL(baseURL).origin],
    telemetry: { enabled: false },
    disabledPaths: DISABLED_HTTP_PATHS,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: EMAIL_LINK_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        deliver("password reset", user.email, { to: user.email, ...passwordResetEmail(user.name, url) });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: EMAIL_LINK_TTL_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        deliver("verification", user.email, { to: user.email, ...verificationEmail(user.name, url) });
      },
    },
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: 60 * 60 * 24,
      // Off on purpose: role and verification changes must apply on the next request.
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      user: {
        create: {
          // Every new account gets buyer_tenant from the server-side allowlist, never from input.
          after: async (user) => {
            await grantRoles(db, user.id, [SIGN_UP_ROLE]);
          },
        },
      },
    },
    advanced: {
      useSecureCookies: production,
      cookiePrefix: "vpk",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: production },
    },
    plugins,
  });
}

export type Auth = ReturnType<typeof createAuth>;
