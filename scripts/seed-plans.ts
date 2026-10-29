/**
 * Operator-only: seed placeholder SANDBOX plans (KES 1–3) for Daraja sandbox testing. Idempotent:
 * existing (code, version) rows are left alone. Real prices are added later as version 2, never
 * by editing these rows (plan terms are immutable by trigger).
 *
 *   PLANS_SEED_CONFIRM=yes npm run plans:seed
 *   PowerShell: $env:PLANS_SEED_CONFIRM="yes"; npm run plans:seed
 *
 * Uses DATABASE_URL_UNPOOLED (or DATABASE_URL) from .env / .env.local.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";

type NewPlan = typeof schema.plans.$inferInsert;

const SANDBOX_PLANS: NewPlan[] = [
  { code: "starter", version: 1, kind: "listing", name: "Starter", priceKes: 1, listingLimit: 3 },
  { code: "pro", version: 1, kind: "listing", name: "Pro", priceKes: 2, listingLimit: 20 },
  {
    code: "agency",
    version: 1,
    kind: "listing",
    name: "Agency",
    priceKes: 3,
    listingLimit: 100,
    isAgencyPlan: true,
  },
  { code: "verification", version: 1, kind: "verification", name: "Verification", priceKes: 1, listingLimit: null },
];

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable URL)";
  }
}

async function main(): Promise<number> {
  if (process.env.PLANS_SEED_CONFIRM !== "yes") {
    console.error("Refusing to run: set PLANS_SEED_CONFIRM=yes to confirm you are the operator.");
    return 1;
  }
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED or DATABASE_URL is required (see .env.example).");
    return 1;
  }

  console.info(`Seeding sandbox plans on ${hostOf(url)}`);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle({ client: pool, schema });
    const inserted = await db
      .insert(schema.plans)
      .values(SANDBOX_PLANS)
      .onConflictDoNothing({ target: [schema.plans.code, schema.plans.version] })
      .returning({ code: schema.plans.code });
    const insertedCodes = new Set(inserted.map((row) => row.code));
    console.table(
      SANDBOX_PLANS.map((plan) => ({
        code: plan.code,
        version: plan.version,
        kind: plan.kind,
        limit: plan.listingLimit ?? "-",
        priceKes: plan.priceKes,
        result: insertedCodes.has(plan.code) ? "inserted" : "already existed",
      })),
    );
    console.info(`${inserted.length} inserted, ${SANDBOX_PLANS.length - inserted.length} already existed.`);
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("seed-plans failed:", error instanceof Error ? error.message : "unknown error");
    process.exit(1);
  },
);
