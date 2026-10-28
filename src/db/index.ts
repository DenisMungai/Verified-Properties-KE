import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getServerEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Neon over HTTP (pooled DATABASE_URL): one-shot queries from Server Components, Actions and
 * Route Handlers. It cannot run interactive transactions; use withTransaction() from ./tx.
 */
function create() {
  return drizzle({ client: neon(getServerEnv().DATABASE_URL), schema });
}

let db: ReturnType<typeof create> | undefined;

export function getDb() {
  db ??= create();
  return db;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
