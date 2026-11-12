/**
 * Who may see a lister's contacts (owner decision 2026-11-12, prompt lister-contact-buttons,
 * replacing the plan §16 default). Decided on the server; the page only ever receives what this
 * allows.
 *
 * | Lister       | Signed-out visitor | Signed-in visitor (verified email) |
 * |--------------|--------------------|------------------------------------|
 * | Verified     | all contacts       | all contacts                       |
 * | Not verified | none               | all contacts                       |
 *
 * The listing's agency contacts follow the same rule: the badge belongs to the listing owner.
 */

export type ContactVisibility =
  /** Verified lister: contacts are open to every visitor. */
  | "public"
  /** Unverified lister, viewed by a signed-in user with a verified email. */
  | "signed_in"
  | "hidden";

export function contactVisibility({
  listerVerified,
  viewerSignedIn,
}: {
  listerVerified: boolean;
  /** Signed in with a verified email address. */
  viewerSignedIn: boolean;
}): ContactVisibility {
  if (listerVerified) return "public";
  if (viewerSignedIn) return "signed_in";
  return "hidden";
}

/** One person's or office's contacts. Phone numbers are E.164; null means "not given". */
export interface ContactPoint {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
}

/** What a listing offers: the lister's own contacts and, for agency listings, the office's. */
export interface ListerContact {
  lister: ContactPoint;
  agency: (ContactPoint & { name: string }) | null;
}

export const NO_CONTACT_POINT: ContactPoint = { phone: null, whatsapp: null, email: null };
export const NO_CONTACT: ListerContact = { lister: NO_CONTACT_POINT, agency: null };

export function hasAnyContact(point: ContactPoint | null): boolean {
  return Boolean(point && (point.phone || point.whatsapp || point.email));
}

/** The contacts this viewer may see: everything, or nothing. */
export function visibleContact(contact: ListerContact, visibility: ContactVisibility): ListerContact {
  if (visibility === "hidden") return NO_CONTACT;
  return { lister: contact.lister, agency: hasAnyContact(contact.agency) ? contact.agency : null };
}

/** The numbers the mobile bar dials: the agent's, or the office's when the agent gave none. */
export function primaryContact(contact: ListerContact): ContactPoint {
  return hasAnyContact(contact.lister) ? contact.lister : (contact.agency ?? NO_CONTACT_POINT);
}
