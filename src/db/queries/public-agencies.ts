import "server-only";
import { and, asc, eq, exists, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, agencyMembers, listerProfiles, properties } from "@/db/schema";
import type { ContactPoint } from "@/lib/listings/contact";
import type { ListerType } from "@/lib/roles";

/**
 * Public agency pages (prompt S23 decision 11). Only public columns leave these functions: no
 * user ids, emails or phone numbers. An agency has a page only while it has a published listing.
 */

export interface PublicAgency {
  name: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  logoKey: string | null;
}

export interface PublicAgencyResult {
  agency: PublicAgency;
  /** Server-only: for the listings and team queries. Never render or serialise it. */
  agencyId: string;
}

const hasPublishedListing = (agencyId: typeof agencies.id) =>
  exists(
    sql`(select 1 from ${properties} where ${properties.agencyId} = ${agencyId} and ${properties.status} = 'published')`,
  );

export async function getPublicAgency(db: DbExecutor, slug: string): Promise<PublicAgencyResult | null> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const [row] = await db
    .select({
      agencyId: agencies.id,
      name: agencies.name,
      slug: agencies.slug,
      description: agencies.description,
      websiteUrl: agencies.websiteUrl,
      logoKey: agencies.logoKey,
    })
    .from(agencies)
    .where(and(eq(agencies.slug, slug), hasPublishedListing(agencies.id)))
    .limit(1);
  if (!row) return null;
  const { agencyId, ...agency } = row;
  return { agency, agencyId };
}

export interface PublicTeamMember {
  displayName: string;
  avatarKey: string | null;
  listerType: ListerType;
  /** From `lister_verified_now`, never stored. */
  verified: boolean;
}

/** Members with at least one published listing under this agency; others stay unlisted. */
export async function getPublicTeam(db: DbExecutor, agencyId: string): Promise<PublicTeamMember[]> {
  return db
    .select({
      displayName: listerProfiles.displayName,
      avatarKey: listerProfiles.avatarKey,
      listerType: listerProfiles.listerType,
      verified: sql<boolean>`lister_verified_now(${listerProfiles.userId})`,
    })
    .from(agencyMembers)
    .innerJoin(listerProfiles, and(eq(listerProfiles.userId, agencyMembers.userId), eq(listerProfiles.agencyId, agencyId)))
    .where(
      and(
        eq(agencyMembers.agencyId, agencyId),
        exists(
          sql`(select 1 from ${properties} where ${properties.agencyId} = ${agencyId}
            and ${properties.ownerUserId} = ${agencyMembers.userId} and ${properties.status} = 'published')`,
        ),
      ),
    )
    .orderBy(asc(listerProfiles.displayName))
    .limit(60);
}

/** The office contacts. Callers read these only for signed-in viewers with a verified email. */
export async function getAgencyOffice(db: DbExecutor, agencyId: string): Promise<ContactPoint & { name: string }> {
  const [row] = await db
    .select({ name: agencies.name, phone: agencies.publicPhone, whatsapp: agencies.whatsapp, email: agencies.publicEmail })
    .from(agencies)
    .where(eq(agencies.id, agencyId))
    .limit(1);
  return row ?? { name: "", phone: null, whatsapp: null, email: null };
}
