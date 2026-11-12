/**
 * Direct reads and the few fixture writes the plan rules need (prompt S22 implementation
 * requirement 5), on the e2e branch only: the pool is built from e2eDatabaseUrls(), which
 * refuses every other endpoint before connecting.
 */
import { Pool, type QueryResultRow } from "pg";
import { e2eDatabaseUrls } from "./env";

let pool: Pool | undefined;

function getPool(): Pool {
  // verify-full is what pg already does for "require"; saying so silences its warning.
  const url = e2eDatabaseUrls().direct.replace("sslmode=require", "sslmode=verify-full");
  pool ??= new Pool({ connectionString: url, max: 2 });
  return pool;
}

export async function sql<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function one<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T> {
  const rows = await sql<T>(text, params);
  if (rows.length !== 1) throw new Error(`[e2e] expected one row, got ${rows.length}: ${text}`);
  return rows[0];
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
