import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { userRoles } from "@/db/schema";
import type { Role } from "@/lib/roles";

export async function getUserRoles(db: DbExecutor, userId: string): Promise<Role[]> {
  const rows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((row) => row.role);
}

/** Idempotent: granting a role the user already has changes nothing. */
export async function grantRoles(db: DbExecutor, userId: string, roles: readonly Role[]): Promise<void> {
  if (roles.length === 0) return;
  await db
    .insert(userRoles)
    .values(roles.map((role) => ({ userId, role })))
    .onConflictDoNothing();
}

export async function revokeRoles(db: DbExecutor, userId: string, roles: readonly Role[]): Promise<void> {
  if (roles.length === 0) return;
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.role, [...roles])));
}
