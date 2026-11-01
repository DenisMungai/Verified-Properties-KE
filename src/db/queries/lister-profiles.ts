import { eq, inArray } from "drizzle-orm";
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

/**
 * Points the lister's profile at a new avatar (prompt lister-avatars decision 5). Returns the key
 * it replaced so the caller can delete those objects, or `undefined` when the user has no lister
 * profile (nothing was written).
 */
export async function setAvatar(tx: DbExecutor, userId: string, baseKey: string): Promise<string | null | undefined> {
  const [previous] = await tx
    .select({ key: listerProfiles.avatarKey })
    .from(listerProfiles)
    .where(eq(listerProfiles.userId, userId))
    .for("update")
    .limit(1);
  if (!previous) return undefined;
  await tx.update(listerProfiles).set({ avatarKey: baseKey }).where(eq(listerProfiles.userId, userId));
  return previous.key;
}

/** Clears the lister's avatar and returns the removed key, or null when there was none. */
export async function clearAvatar(tx: DbExecutor, userId: string): Promise<string | null> {
  const [previous] = await tx
    .select({ key: listerProfiles.avatarKey })
    .from(listerProfiles)
    .where(eq(listerProfiles.userId, userId))
    .for("update")
    .limit(1);
  if (!previous?.key) return null;
  await tx.update(listerProfiles).set({ avatarKey: null }).where(eq(listerProfiles.userId, userId));
  return previous.key;
}

/** Which of these avatar base keys a lister profile still points at (orphan sweep). */
export async function referencedAvatarKeys(db: DbExecutor, baseKeys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < baseKeys.length; i += 500) {
    const rows = await db
      .select({ key: listerProfiles.avatarKey })
      .from(listerProfiles)
      .where(inArray(listerProfiles.avatarKey, baseKeys.slice(i, i + 500)));
    for (const row of rows) if (row.key) found.add(row.key);
  }
  return found;
}
