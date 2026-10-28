/**
 * Operator-only: grant platform_admin (default) or billing_admin to an existing, email-verified
 * account. Never exposed in the app.
 *
 *   ADMIN_CREATE_CONFIRM=yes npm run admin:create -- someone@example.com [--role billing_admin]
 *   PowerShell: $env:ADMIN_CREATE_CONFIRM="yes"; npm run admin:create -- someone@example.com
 *
 * Uses DATABASE_URL_UNPOOLED (or DATABASE_URL) from .env / .env.local.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DbExecutor } from "../src/db/executor";
import * as schema from "../src/db/schema";
import { grantOperatorRole } from "../src/lib/admin-grant";
import { maskEmail } from "../src/lib/email/send";

function parseArgs(argv: string[]): { email?: string; role: string } {
  let email: string | undefined;
  let role = "platform_admin";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--role") role = argv[++i] ?? "";
    else if (!argv[i].startsWith("--")) email = argv[i];
  }
  return { email, role };
}

const MESSAGES = {
  granted: "granted",
  "already-had-role": "already had this role; nothing changed",
  "no-such-user": "no account with that email. Sign up first, then run this again.",
  "email-not-verified": "the account has not confirmed its email yet. Confirm it first.",
  "invalid-role": "role must be platform_admin or billing_admin.",
} as const;

async function main(): Promise<number> {
  const { email, role } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error("Usage: npm run admin:create -- someone@example.com [--role billing_admin]");
    return 1;
  }
  if (process.env.ADMIN_CREATE_CONFIRM !== "yes") {
    console.error("Refusing to run: set ADMIN_CREATE_CONFIRM=yes to confirm you are the operator.");
    return 1;
  }
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED or DATABASE_URL is required (see .env.example).");
    return 1;
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle({ client: pool, schema }) as unknown as DbExecutor;
    const result = await grantOperatorRole(db, email, role);
    const ok = result.status === "granted" || result.status === "already-had-role";
    (ok ? console.info : console.error)(`${role} for ${maskEmail(email)}: ${MESSAGES[result.status]}`);
    return ok ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("create-admin failed:", error instanceof Error ? error.message : "unknown error");
    process.exit(1);
  },
);
