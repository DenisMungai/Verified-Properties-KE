import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { users } from "@/db/schema";
import { getUserRoles, grantRoles } from "@/db/queries/roles";
import { OPERATOR_GRANTABLE_ROLES, type OperatorRole } from "@/lib/roles";

export type GrantResult =
  | { status: "granted" | "already-had-role"; userId: string }
  | { status: "no-such-user" | "email-not-verified" | "invalid-role" };

/**
 * Operator-only (scripts/create-admin.ts): grants platform_admin or billing_admin to an existing,
 * email-verified account. Never reachable from the web app.
 */
export async function grantOperatorRole(db: DbExecutor, email: string, role: string): Promise<GrantResult> {
  if (!(OPERATOR_GRANTABLE_ROLES as readonly string[]).includes(role)) return { status: "invalid-role" };
  const [user] = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!user) return { status: "no-such-user" };
  if (!user.emailVerified) return { status: "email-not-verified" };

  const roles = await getUserRoles(db, user.id);
  if (roles.includes(role as OperatorRole)) return { status: "already-had-role", userId: user.id };
  await grantRoles(db, user.id, [role as OperatorRole]);
  return { status: "granted", userId: user.id };
}
