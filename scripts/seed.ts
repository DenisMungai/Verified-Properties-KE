/**
 * Operator-only: SAMPLE data for a development branch (prompt S11). Never production.
 *
 *   npm run db:seed -- --dry-run          shows the target and what a seed would add; writes nothing
 *   SEED_CONFIRM=<endpoint> npm run db:seed
 *   SEED_CONFIRM=<endpoint> npm run db:seed -- --remove
 *   PowerShell: $env:SEED_CONFIRM="<endpoint>"; npm run db:seed
 *
 * <endpoint> is the database host's first label (e.g. ep-cool-name-a1b2c3d4), printed by a run
 * without SEED_CONFIRM. Typing it confirms the branch about to change, so an env file pointing
 * somewhere unexpected can't be seeded by accident. Uses DATABASE_URL_UNPOOLED (or DATABASE_URL).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DbExecutor } from "../src/db/executor";
import { removeSampleData, sampleStatus, seedSampleData, type SeedDeps } from "../src/db/seed/seed";
import { getPublicStore, storageModeFor } from "../src/lib/storage";
import { openScriptContext, parseArgs, run } from "./lib/mpesa-script";

const ASSETS_DIR = path.join(process.cwd(), "scripts", "seed-assets");

/** `ep-cool-name-a1b2c3d4` from a Neon host, without the `-pooler` suffix; null if unparseable. */
function endpointOf(url: string): string | null {
  try {
    const label = new URL(url).hostname.split(".")[0];
    return label ? label.replace(/-pooler$/, "") : null;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const { flags } = parseArgs(process.argv.slice(2));
  const remove = flags.remove === "true";
  const dryRun = flags["dry-run"] === "true";

  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run with NODE_ENV=production. Sample data is for development branches only.");
    return 1;
  }
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const endpoint = url ? endpointOf(url) : null;
  if (!url || !endpoint) {
    console.error("DATABASE_URL_UNPOOLED or DATABASE_URL must be a valid connection string (see .env.example).");
    return 1;
  }
  console.info(`Target endpoint: ${endpoint}`);

  const ctx = openScriptContext();
  try {
    if (dryRun) {
      const status = await sampleStatus(ctx.db);
      console.table(status.listers.map((l) => ({ user: l.userId, result: l.exists ? "already exists" : "would insert" })));
      console.info(
        `Listings: ${status.listingsPlanned} planned, ${status.listingsExisting} already exist. ` +
          `Photos for new listings: up to ${status.photosPlanned}.`,
      );
      console.info(`Dry run: nothing written. To ${remove ? "remove" : "seed"} for real:`);
      console.info(`  PowerShell: $env:SEED_CONFIRM="${endpoint}"; npm run db:seed${remove ? " -- --remove" : ""}`);
      return 0;
    }

    if (process.env.SEED_CONFIRM !== endpoint) {
      console.error(
        process.env.SEED_CONFIRM
          ? `Refusing to run: SEED_CONFIRM does not match the target endpoint ${endpoint}.`
          : "Refusing to run: SEED_CONFIRM is not set.",
      );
      console.error(`To confirm this branch: $env:SEED_CONFIRM="${endpoint}"; npm run db:seed${remove ? " -- --remove" : ""}`);
      return 1;
    }

    const mode = storageModeFor(ctx.env);
    if (mode === "none") {
      console.error("Refusing to run: photo storage is not configured (set the STORAGE_* variables).");
      return 1;
    }
    if (mode === "dev-disk") {
      console.warn("Storage is the local dev disk: photos will only show on this machine, not on the live site.");
    }

    const db: DbExecutor = ctx.db;
    const deps: SeedDeps = {
      db,
      withTransaction: (fn) => db.transaction((tx) => fn(tx as unknown as DbExecutor)),
      publicStore: getPublicStore(),
      now: () => new Date(),
      readAsset: (name) => readFile(path.join(ASSETS_DIR, `${name}.webp`)),
    };

    if (remove) {
      const report = await removeSampleData(deps);
      console.table([report]);
      if (report.storageErrors > 0) console.warn(`${report.storageErrors} storage delete(s) failed; the orphan sweep will retry.`);
      console.info("Sample data removed. Users, invoices, payments and events stay by design.");
      return 0;
    }

    const report = await seedSampleData(deps);
    console.table(report.plans.map((p) => ({ plan: p.code, result: p.result })));
    console.table(report.listers);
    const inserted = report.listers.reduce((sum, l) => sum + l.listingsInserted, 0);
    const photos = report.listers.reduce((sum, l) => sum + l.photos, 0);
    console.info(`Seed complete: ${inserted} listings and ${photos} photos inserted.`);
    return 0;
  } finally {
    await ctx.close();
  }
}

run("db:seed", main);
