import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Any Drizzle Postgres database or transaction over our schema: the Neon HTTP client, the Neon
 * WebSocket transaction, or node-postgres in tests and scripts. Query functions that write take
 * one of these so they can run inside a caller's transaction and be tested against a real branch.
 */
export type DbExecutor = PgDatabase<PgQueryResultHKT, typeof schema>;
