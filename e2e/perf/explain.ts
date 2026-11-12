/**
 * S22 performance pass (prompt decision 9): query plans for the public search and home queries,
 * taken from the app's own query builders. Each query runs once through a logging Drizzle client
 * against the Neon e2e branch (never production: EXPLAIN ANALYZE executes the query), then is
 * re-run under EXPLAIN (ANALYZE, BUFFERS).
 *
 *   node --conditions=react-server --import tsx e2e/perf/explain.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DbExecutor } from "../../src/db/executor";
import { homeSections, searchListings } from "../../src/db/queries/public-listings";
import * as schema from "../../src/db/schema";
import { parseSearchParams } from "../../src/lib/search/params";
import { e2eDatabaseUrls } from "../support/env";

interface Captured {
  sql: string;
  params: unknown[];
}

const CASES: [string, Record<string, string>][] = [
  ["Recommended, no filters", {}],
  ["Recommended, rent in Nairobi", { mode: "rent", q: "Nairobi" }],
  ["Recommended, buy, 3+ beds, price cap", { mode: "buy", beds: "3", maxPrice: "20000000" }],
  ["Newest, rent", { mode: "rent", sort: "newest" }],
  ["Price low to high, buy", { mode: "buy", sort: "price_asc" }],
  ["Verified listers only", { verified: "1" }],
  ["Page 2, Recommended", { page: "2" }],
];

function summarize(plan: string[]): string[] {
  const keep = /Seq Scan|Index|Bitmap|Sort|Hash Join|Nested Loop|Limit|WindowAgg|Planning Time|Execution Time|Function Scan|CTE Scan|Rows Removed/;
  return plan.filter((line) => keep.test(line)).map((line) => line.replace(/\s+\(cost=[^)]*\)/, ""));
}

async function main(): Promise<void> {
  const url = e2eDatabaseUrls().direct.replace("sslmode=require", "sslmode=verify-full");
  const pool = new Pool({ connectionString: url, max: 2 });
  let captured: Captured[] = [];
  const db = drizzle({
    client: pool,
    schema,
    logger: { logQuery: (sql, params) => captured.push({ sql, params }) },
  }) as unknown as DbExecutor;

  const run = async (name: string, fn: () => Promise<unknown>) => {
    captured = [];
    await fn();
    console.info(`\n=== ${name} (${captured.length} quer${captured.length === 1 ? "y" : "ies"})`);
    for (const [i, q] of captured.entries()) {
      const { rows } = await pool.query<{ "QUERY PLAN": string }>(`explain (analyze, buffers) ${q.sql}`, q.params);
      const plan = rows.map((r) => r["QUERY PLAN"]);
      console.info(`--- query ${i + 1}: ${q.sql.replace(/\s+/g, " ").slice(0, 90)}…`);
      for (const line of summarize(plan)) console.info(line);
      // With seq scans priced out, any table still seq-scanned has no index for this query.
      const client = await pool.connect();
      try {
        await client.query("set enable_seqscan = off");
        const off = await client.query<{ "QUERY PLAN": string }>(`explain ${q.sql}`, q.params);
        const scans = off.rows
          .map((r) => r["QUERY PLAN"].trim().replace(/^->\s*/, "").replace(/\s+\(cost=[^)]*\)/, ""))
          .filter((line) => /Scan/.test(line));
        console.info(`    scans with enable_seqscan=off: ${[...new Set(scans)].join("; ")}`);
        // How often the plan evaluates the verified check per row (inlined CTEs repeat it).
        const verbose = await client.query<{ "QUERY PLAN": string }>(`explain verbose ${q.sql}`, q.params);
        const calls = verbose.rows.map((r) => r["QUERY PLAN"]).join(" ").split("lister_verified_now(").length - 1;
        console.info(`    lister_verified_now() in plan: ${calls}`);
      } finally {
        await client.query("reset enable_seqscan");
        client.release();
      }
    }
  };

  const now = new Date();
  for (const [name, raw] of CASES) {
    const { filters } = parseSearchParams(raw);
    await run(`search: ${name}`, () => searchListings(db, filters, now));
  }
  await run("home sections", () => homeSections(db, now));
  const { rows } = await pool.query<{ n: string }>(`select count(*)::text as n from properties`);
  console.info(`\nproperties rows on the e2e branch: ${rows[0].n}`);
  await pool.end();
}

void main();
