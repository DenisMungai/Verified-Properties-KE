/**
 * Call, WhatsApp and Email links for a listing's contact buttons (prompt lister-contact-buttons
 * decision 4). Pure: the page passes the listing title and its absolute URL.
 */

export interface ListingRef {
  title: string;
  /** Absolute URL of the listing page. */
  url: string;
}

const E164_KENYA = /^\+254\d{9}$/;

/** `tel:` link, or null for anything that isn't a stored E.164 number. */
export function telHref(e164: string): string | null {
  return E164_KENYA.test(e164) ? `tel:${e164}` : null;
}

/** WhatsApp click-to-chat (`wa.me` takes the number without "+"), pre-filled about the listing. */
export function whatsappHref(e164: string, listing: ListingRef): string | null {
  if (!E164_KENYA.test(e164)) return null;
  const text = `Hi, I'm interested in "${listing.title}" on VerifiedPropertiesKE: ${listing.url}`;
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(text)}`;
}

/** `mailto:` with the listing in the subject and its link in the body. */
export function mailtoHref(email: string, listing: ListingRef): string {
  const subject = `Enquiry: ${listing.title}`;
  const body = `Hi,\n\nI'm interested in "${listing.title}" on VerifiedPropertiesKE:\n${listing.url}\n`;
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
