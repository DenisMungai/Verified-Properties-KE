/**
 * Shared setup for the M-Pesa dev and operator scripts (prompt S5 decision 11). They run with
 * `--conditions=react-server`, so the app's `server-only` modules load outside Next.js.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DbExecutor } from "../../src/db/executor";
import { storedStkResult } from "../../src/db/queries/payments";
import * as schema from "../../src/db/schema";
import { parseServerEnv, type ServerEnv } from "../../src/lib/env";
import type { DarajaClient } from "../../src/lib/mpesa/client";
import { mpesaSettingsFor, type MpesaSettings } from "../../src/lib/mpesa/config";
import { createDarajaClient } from "../../src/lib/mpesa/daraja";
import type { PaymentDeps } from "../../src/lib/mpesa/deps";
import { createSimulatorClient } from "../../src/lib/mpesa/simulator";
import { getRateLimiter } from "../../src/lib/rate-limit";

export interface ScriptContext {
  env: ServerEnv;
  db: DbExecutor;
  close: () => Promise<void>;
}

/** `--name value` pairs; a flag with no value reads as "true". */
export function parseArgs(argv: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[arg.slice(2)] = next;
        i++;
      } else {
        flags[arg.slice(2)] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function openScriptContext(): ScriptContext {
  const env = parseServerEnv(process.env);
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle({ client: pool, schema }) as unknown as DbExecutor;
  return { env, db, close: () => pool.end() };
}

export function clientFor(settings: MpesaSettings, db: DbExecutor): DarajaClient {
  return settings.mode === "daraja" && settings.credentials
    ? createDarajaClient({ baseUrl: settings.baseUrl, shortcode: settings.shortcode, ...settings.credentials })
    : createSimulatorClient((checkoutRequestId) => storedStkResult(db, checkoutRequestId));
}

/** The same dependencies the app builds, over node-postgres; null when M-Pesa is not set up. */
export function scriptPaymentDeps(ctx: ScriptContext): PaymentDeps | null {
  const settings = mpesaSettingsFor(ctx.env);
  if (!settings) return null;
  const db = ctx.db;
  return {
    db,
    withTransaction: (fn) => db.transaction((tx) => fn(tx as unknown as DbExecutor)),
    daraja: clientFor(settings, db),
    settings,
    now: () => new Date(),
    rateLimiter: getRateLimiter(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function run(name: string, main: () => Promise<number>): void {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`${name} failed:`, error instanceof Error ? error.message : "unknown error");
      process.exit(1);
    },
  );
}
