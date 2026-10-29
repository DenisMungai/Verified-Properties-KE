import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getListerProfile } from "@/db/queries/lister-profiles";
import { LISTER_ROLES, hasAnyRole } from "@/lib/roles";
import { requireUser, type CurrentUser } from "@/lib/session";

/**
 * Signed-in lister with a lister profile, or a redirect to onboarding. Used by every listing page
 * and action; ownership of a particular listing is checked separately by `manageableBy`.
 */
export async function requireLister(next: string): Promise<CurrentUser> {
  const user = await requireUser(next);
  if (!hasAnyRole(user.roles, LISTER_ROLES)) redirect("/account/onboarding");
  const profile = await getListerProfile(getDb(), user.id);
  if (!profile) redirect("/account/onboarding");
  return user;
}
