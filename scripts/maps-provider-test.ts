/**
 * S18 map provider test: Google Maps vs Mapbox on 50 Kenyan locations
 * (prompts/s18-map-provider-test.md).
 *
 *   npm run maps:test                      dry run: key status and planned requests, no network
 *   npm run maps:test -- --run             fetch references, run both providers, write the report
 *   npm run maps:test -- --run --only=google
 *   npm run maps:test -- --run --refresh-reference
 *   npm run maps:test -- --report-only     rebuild the report from cached outcomes (no network)
 */
import { z } from "zod";
import { MAX_BILLABLE_PER_PROVIDER } from "./lib/maps-test/config";
import { scrub } from "./lib/maps-test/http";
import { computeResults, REPORT_FILE, writeReport } from "./lib/maps-test/report";
import { billableFor, plan, providerPasses, referencePass, writeTileIndex, type Keys } from "./lib/maps-test/runner";
import { loadOutcomes, loadReferences } from "./lib/maps-test/store";
import type { ProviderId } from "./lib/maps-test/types";

const envSchema = z.object({
  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
  MAPBOX_ACCESS_TOKEN: z.string().min(1).optional(),
});

function readKeys(): Keys {
  const env = envSchema.parse({
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY?.trim() || undefined,
    MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN?.trim() || undefined,
  });
  return { google: env.GOOGLE_MAPS_API_KEY, mapbox: env.MAPBOX_ACCESS_TOKEN };
}

interface Flags {
  run: boolean;
  reportOnly: boolean;
  refreshReference: boolean;
  only: ProviderId | null;
}

function parseFlags(argv: readonly string[]): Flags | string {
  const flags: Flags = { run: false, reportOnly: false, refreshReference: false, only: null };
  for (const arg of argv) {
    if (arg === "--run") flags.run = true;
    else if (arg === "--dry-run") flags.run = false;
    else if (arg === "--report-only") flags.reportOnly = true;
    else if (arg === "--refresh-reference") flags.refreshReference = true;
    else if (arg === "--only=google" || arg === "--only=mapbox") flags.only = arg.slice("--only=".length) as ProviderId;
    else return `Unknown argument: ${arg}`;
  }
  if (flags.run && flags.reportOnly) return "Use either --run or --report-only, not both.";
  return flags;
}

const log = (message: string) => console.info(message);

function printPlan(keys: Keys, providers: readonly ProviderId[]): void {
  const store = loadOutcomes();
  const refs = loadReferences();
  log(`Keys: Google ${keys.google ? "set" : "not set"}, Mapbox ${keys.mapbox ? "set" : "not set"}`);
  log(`References stored: ${refs.size} / 50 (missing ones are fetched from Nominatim on --run, not billed)`);
  const lines = plan(store, refs, providers);
  console.table(lines.map((l) => ({ provider: l.provider, api: l.api, planned: l.total, cached: l.cached, billable: l.billable, note: l.note ?? "" })));
  for (const p of providers) {
    log(`${p}: ${billableFor(lines, p)} billable now (cap ${MAX_BILLABLE_PER_PROVIDER} per run)${keys[p] ? "" : ", skipped: no key"}`);
  }
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  if (typeof flags === "string") {
    console.error(flags);
    return 1;
  }
  const keys = readKeys();
  const providers: ProviderId[] = flags.only ? [flags.only] : ["google", "mapbox"];

  if (flags.reportOnly) {
    writeReport(computeResults(loadOutcomes(), loadReferences()));
    log(`report written: ${REPORT_FILE} (from cached outcomes, no requests made)`);
    return 0;
  }

  if (!flags.run) {
    printPlan(keys, providers);
    log("dry run, no requests made. Add --run to call the providers.");
    return 0;
  }

  const active = providers.filter((p) => keys[p]);
  const refs = loadReferences();
  await referencePass(refs, flags.refreshReference, log);
  if (active.length === 0) {
    log("No provider key is set, so only the free reference pass ran.");
    log("Fill GOOGLE_MAPS_API_KEY and/or MAPBOX_ACCESS_TOKEN in .env, then run again.");
    return 0;
  }

  const store = loadOutcomes();
  const lines = plan(store, refs, active);
  for (const p of active) {
    const billable = billableFor(lines, p);
    if (billable > MAX_BILLABLE_PER_PROVIDER) {
      console.error(`${p}: ${billable} billable requests planned, over the cap of ${MAX_BILLABLE_PER_PROVIDER}. Nothing sent.`);
      return 1;
    }
    log(`${p}: ${billable} billable requests planned (cap ${MAX_BILLABLE_PER_PROVIDER}).`);
  }

  const runs = await providerPasses({ keys, providers: active, refreshReference: flags.refreshReference }, store, refs, log);
  for (const run of runs.values()) {
    log(`${run.id}: billed this run ${run.budget.billed}, failed ${run.failures}${run.disabled ? `, stopped: ${run.disabled}` : ""}`);
  }
  for (const p of providers.filter((x) => !keys[x])) log(`${p}: not tested (no key)`);

  const tiles = writeTileIndex();
  writeReport(computeResults(store, refs));
  log(`tile comparison: ${tiles}`);
  log(`report written: ${REPORT_FILE}`);
  return [...runs.values()].some((r) => r.failures > 0 || r.disabled) ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const keys = readKeys();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`maps-provider-test failed: ${scrub(message, [keys.google, keys.mapbox])}`);
    process.exit(1);
  },
);
