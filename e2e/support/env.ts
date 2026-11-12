/**
 * E2E environment (prompt S22 decisions 1 and 2). Everything the suite runs (the dev server on
 * :3100, the npm scripts it calls, direct database reads) points at the Neon `e2e` branch only.
 * Every helper that touches a database goes through `e2eDatabaseUrls()`, which refuses any other
 * host before a connection is opened.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const E2E_PORT = 3100;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_DIST_DIR = ".next-e2e";
export const ROOT = path.resolve(__dirname, "..", "..");
/**
 * Outside the project on purpose: the dev server watches the project folder, and a log written
 * there on every request made it recompile and reload the page in a loop.
 */
export const E2E_DATA_DIR = path.join(os.tmpdir(), "verifiedpropertieske-e2e");
export const SERVER_LOG = path.join(E2E_DATA_DIR, "server.log");

let loaded = false;

/** .env.local wins over .env, and the real process env wins over both (same as Next.js). */
export function loadEnvFiles(): void {
  if (loaded) return;
  loaded = true;
  for (const file of [".env.local", ".env"]) {
    const full = path.join(ROOT, file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}

/** "ep-super-base-b9lh695m-pooler.c-7…" -> "ep-super-base-b9lh695m" (pooled and direct match). */
export function endpointLabel(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

export class E2eGuardError extends Error {
  constructor(message: string) {
    super(`[e2e guard] ${message}`);
    this.name = "E2eGuardError";
  }
}

export interface E2eDatabaseUrls {
  pooled: string;
  direct: string;
  label: string;
}

/**
 * The e2e branch's connection strings, after checking they name one endpoint and that it is not
 * the dev, test or production endpoint from the same env files. Throws otherwise.
 */
export function e2eDatabaseUrls(): E2eDatabaseUrls {
  loadEnvFiles();
  const pooled = process.env.E2E_DATABASE_URL;
  const direct = process.env.E2E_DATABASE_URL_UNPOOLED;
  const label = endpointLabel(pooled);
  if (!pooled || !direct || !label) {
    throw new E2eGuardError("E2E_DATABASE_URL and E2E_DATABASE_URL_UNPOOLED must be set in .env.local.");
  }
  if (endpointLabel(direct) !== label) {
    throw new E2eGuardError("E2E_DATABASE_URL and E2E_DATABASE_URL_UNPOOLED point at different endpoints.");
  }
  const forbidden = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "TEST_DATABASE_URL", "PROD_DATABASE_URL_UNPOOLED"];
  for (const name of forbidden) {
    if (endpointLabel(process.env[name]) === label) {
      throw new E2eGuardError(`the e2e endpoint is the same as ${name}; refusing to run.`);
    }
  }
  return { pooled, direct, label };
}

/**
 * Environment for the e2e dev server and for the npm scripts the tests call. Empty strings beat
 * the env files (empty values are treated as unset by the app), so these stay off.
 */
export function e2eProcessEnv(): NodeJS.ProcessEnv {
  const db = e2eDatabaseUrls();
  return {
    ...process.env,
    DATABASE_URL: db.pooled,
    DATABASE_URL_UNPOOLED: db.direct,
    TEST_DATABASE_URL: "",
    PROD_DATABASE_URL_UNPOOLED: "",
    NEXT_PUBLIC_APP_URL: E2E_ORIGIN,
    NEXT_DIST_DIR: E2E_DIST_DIR,
    // M-Pesa simulator: no Daraja credentials, callbacks to the e2e server, no IP allowlist.
    MPESA_CONSUMER_KEY: "",
    MPESA_CONSUMER_SECRET: "",
    MPESA_PASSKEY: "",
    MPESA_CALLBACK_BASE_URL: E2E_ORIGIN,
    MPESA_CALLBACK_ALLOWED_IPS: "",
    MPESA_CALLBACK_TOKEN: process.env.MPESA_CALLBACK_TOKEN || "e2e-callback-token-not-a-secret-0000",
    // Local disk storage, in-memory rate limits, emails printed to the log.
    STORAGE_S3_ENDPOINT: "",
    STORAGE_ACCESS_KEY_ID: "",
    STORAGE_SECRET_ACCESS_KEY: "",
    STORAGE_PUBLIC_BUCKET: "",
    STORAGE_PRIVATE_BUCKET: "",
    STORAGE_PUBLIC_BASE_URL: "",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    // No jobs scheduling, Sentry, card payments or SMS from the e2e server.
    QSTASH_TOKEN: "",
    QSTASH_CURRENT_SIGNING_KEY: "",
    QSTASH_NEXT_SIGNING_KEY: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
    PAYSTACK_SECRET_KEY: "",
    AT_USERNAME: "",
    AT_API_KEY: "",
    OPS_HEALTH_TOKEN: "",
  };
}
