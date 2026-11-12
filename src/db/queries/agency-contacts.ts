import "server-only";
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, agencyMembers, listerProfiles } from "@/db/schema";
import type { AgencyContactInput } from "@/lib/validation/agency-contact";

/**
 * An agency's office contacts (prompt lister-contact-buttons decision 10). The agency is always
 * the one on the caller's own lister profile (as for billing), never an id from the browser, and
 * only an admin member of it may change the contacts.
 */

export interface AgencyContactView {
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  /** The caller may edit (an admin member of this agency). */
  canEdit: boolean;
}

async function callersAgency(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({
      agencyId: agencies.id,
      name: agencies.name,
      phone: agencies.publicPhone,
      whatsapp: agencies.whatsapp,
      email: agencies.publicEmail,
      role: agencyMembers.role,
    })
    .from(listerProfiles)
    .innerJoin(agencies, eq(agencies.id, listerProfiles.agencyId))
    .leftJoin(agencyMembers, and(eq(agencyMembers.agencyId, agencies.id), eq(agencyMembers.userId, userId)))
    .where(eq(listerProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

/** The caller's agency contacts, or null when they don't list for an agency. */
export async function getAgencyContactFor(db: DbExecutor, userId: string): Promise<AgencyContactView | null> {
  const row = await callersAgency(db, userId);
  if (!row) return null;
  return { name: row.name, phone: row.phone, whatsapp: row.whatsapp, email: row.email, canEdit: row.role === "admin" };
}

export type AgencyContactSaveResult = "saved" | "no_agency" | "not_admin";

/** Saves the caller's agency contacts if, and only if, they are an admin member of it. */
export async function saveAgencyContact(tx: DbExecutor, userId: string, input: AgencyContactInput): Promise<AgencyContactSaveResult> {
  const row = await callersAgency(tx, userId);
  if (!row) return "no_agency";
  if (row.role !== "admin") return "not_admin";
  await tx
    .update(agencies)
    .set({ publicPhone: input.phone, whatsapp: input.whatsapp, publicEmail: input.email })
    .where(eq(agencies.id, row.agencyId));
  return "saved";
}
