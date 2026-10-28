import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { listerProfiles } from "@/db/schema";
import { listerRoleFor, type Role } from "@/lib/roles";
import type { ListerProfileInput } from "@/lib/validation/profile";
import { grantRoles, revokeRoles } from "./roles";

export type ListerProfile = typeof listerProfiles.$inferSelect;

export async function getListerProfile(db: DbExecutor, userId: string): Promise<ListerProfile | null> {
  const [row] = await db.select().from(listerProfiles).where(eq(listerProfiles.userId, userId)).limit(1);
  return row ?? null;
}

/**
 * Creates or updates the caller's lister profile and sets their self-service lister role from the
 * allowlisted mapping (agent → agent, owner/developer → owner). Run it inside a transaction so the
 * profile and the role always change together. Only fields from the validated input are written.
 */
export async function saveListerProfile(
  tx: DbExecutor,
  userId: string,
  input: ListerProfileInput,
): Promise<ListerProfile> {
  const values = {
    listerType: input.listerType,
    displayName: input.displayName,
    phone: input.phone,
    publicEmail: input.publicEmail,
    bio: input.bio,
  };
  const [profile] = await tx
    .insert(listerProfiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: listerProfiles.userId, set: values })
    .returning();

  const role = listerRoleFor(input.listerType);
  const otherSelfServiceRoles: Role[] = (["agent", "owner"] as const).filter((r) => r !== role);
  await revokeRoles(tx, userId, otherSelfServiceRoles);
  await grantRoles(tx, userId, [role]);
  return profile;
}
