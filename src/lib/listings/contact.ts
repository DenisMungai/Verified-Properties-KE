/**
 * Who may see a lister's phone and public email (plan v2.0 §16 default; prompt S8 decision 1).
 * Decided on the server; the page only ever receives what this allows.
 */

export type ContactVisibility =
  /** Verified lister: the phone is public. */
  | "public"
  /** This signed-in viewer has sent an inquiry about the listing. */
  | "after_inquiry"
  | "hidden";

export function contactVisibility({
  listerVerified,
  viewerHasInquired,
}: {
  listerVerified: boolean;
  viewerHasInquired: boolean;
}): ContactVisibility {
  if (viewerHasInquired) return "after_inquiry";
  if (listerVerified) return "public";
  return "hidden";
}

export interface ListerContact {
  phone: string | null;
  email: string | null;
}

/** The contact details this viewer may see. A verified lister's email still needs an inquiry. */
export function visibleContact(contact: ListerContact, visibility: ContactVisibility): ListerContact {
  switch (visibility) {
    case "public":
      return { phone: contact.phone, email: null };
    case "after_inquiry":
      return contact;
    case "hidden":
      return { phone: null, email: null };
  }
}
