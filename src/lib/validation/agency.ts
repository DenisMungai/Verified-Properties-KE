import { z } from "zod";

/**
 * Agency forms (prompt S23). Only these fields are read from a form; the agency itself is always
 * the caller's own, found on the server. Member ids are checked against that agency in SQL.
 */

export const AGENCY_NAME_MAX = 80;
export const AGENCY_DESCRIPTION_MAX = 1000;
export const AGENCY_WEBSITE_MAX = 200;
export const AGENCY_ROLES = ["admin", "member"] as const;
export type AgencyRole = (typeof AGENCY_ROLES)[number];

const name = z
  .string()
  .trim()
  .min(2, { error: "Enter the agency's name (at least 2 characters)." })
  .max(AGENCY_NAME_MAX, { error: `Keep the name under ${AGENCY_NAME_MAX} characters.` });

const description = z
  .string()
  .trim()
  .max(AGENCY_DESCRIPTION_MAX, { error: `Keep the description under ${AGENCY_DESCRIPTION_MAX} characters.` })
  .transform((value) => (value === "" ? null : value));

const WEBSITE_ERROR = "Enter a full https:// address, or leave it blank.";

/** Optional https website; a bare "example.co.ke" gets https:// added. */
const website = z
  .string()
  .trim()
  .max(AGENCY_WEBSITE_MAX, { error: `Keep the address under ${AGENCY_WEBSITE_MAX} characters.` })
  .transform((value, ctx) => {
    if (value === "") return null;
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      ctx.addIssue({ code: "custom", message: WEBSITE_ERROR });
      return z.NEVER;
    }
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) {
      ctx.addIssue({ code: "custom", message: WEBSITE_ERROR });
      return z.NEVER;
    }
    const normalized = url.toString();
    if (normalized.length > AGENCY_WEBSITE_MAX) {
      ctx.addIssue({ code: "custom", message: `Keep the address under ${AGENCY_WEBSITE_MAX} characters.` });
      return z.NEVER;
    }
    return normalized;
  });

export const createAgencySchema = z.object({ name, description });
export type CreateAgencyInput = z.infer<typeof createAgencySchema>;

export const agencyDetailsSchema = z.object({ name, description, website });
export type AgencyDetailsInput = z.infer<typeof agencyDetailsSchema>;

export const agencyRoleSchema = z.enum(AGENCY_ROLES, { error: "Choose admin or member." });

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { error: "Enter the agent's email address." })
    .max(254, { error: "That email address is too long." })
    .pipe(z.email({ error: "Enter a valid email address." })),
  role: agencyRoleSchema.default("member"),
});
export type InviteInput = z.infer<typeof inviteSchema>;

/** Better Auth user ids: letters, digits, `_` and `-`. */
export const memberIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const inviteIdSchema = z.uuid();

export const memberRoleChangeSchema = z.object({ userId: memberIdSchema, role: agencyRoleSchema });
