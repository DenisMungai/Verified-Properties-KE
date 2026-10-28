import "server-only";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { getServerEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * WebSocket (Pool) client for interactive transactions, which the HTTP driver in ./index.ts
 * cannot do. Use it only for multi-step atomic writes (payment confirmation first); keep reads
 * on getDb(). A short-lived pool per call suits serverless functions.
 */
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

type TxDb = ReturnType<typeof drizzle<typeof schema>>;
export type Tx = Parameters<Parameters<TxDb["transaction"]>[0]>[0];

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: getServerEnv().DATABASE_URL });
  try {
    const db = drizzle({ client: pool, schema });
    return await db.transaction(fn);
  } finally {
    await pool.end();
  }
}
