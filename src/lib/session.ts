import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { getUserRoles } from "@/db/queries/roles";
import { getAuth } from "@/lib/auth";
import { hasAnyRole, type Role } from "@/lib/roles";
import { signInPath } from "@/lib/safe-redirect";

/** The narrow user shape pages and components receive (never the raw session or token). */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  roles: Role[];
}

/**
 * Reads the session from the request (once per render via React `cache`). Every caller must sit
 * inside <Suspense> under Cache Components. Roles are read fresh from the database.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    roles: await getUserRoles(getDb(), user.id),
  };
});

/** Signed-in, email-verified user, or a redirect to sign-in that returns to `next`. */
export async function requireUser(next = "/account"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || !user.emailVerified) redirect(signInPath(next));
  return user;
}

/** 404 for anyone without one of the roles, so admin URLs do not reveal that they exist. */
export async function requireRole(roles: readonly Role[], next = "/account"): Promise<CurrentUser> {
  const user = await requireUser(next);
  if (!hasAnyRole(user.roles, roles)) notFound();
  return user;
}
