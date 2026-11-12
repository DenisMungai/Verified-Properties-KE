/**
 * The contact rule (owner decision 2026-11-12, prompt lister-contact-buttons): verified listers'
 * contacts are open to every visitor; unverified listers' contacts only to signed-in visitors.
 */
import { describe, expect, it } from "vitest";
import { NO_CONTACT, contactVisibility, primaryContact, visibleContact, type ListerContact } from "./contact";

const lister = { phone: "+254712000111", whatsapp: "+254712000222", email: "lister@example.test" };
const agency = { name: "Example Realty", phone: "+254722000333", whatsapp: null, email: "office@example.test" };
const contact: ListerContact = { lister, agency };

describe("contact rule", () => {
  it("opens a verified lister's contacts to signed-out and signed-in visitors", () => {
    for (const viewerSignedIn of [false, true]) {
      const visibility = contactVisibility({ listerVerified: true, viewerSignedIn });
      expect(visibility).toBe("public");
      expect(visibleContact(contact, visibility)).toEqual(contact);
    }
  });

  it("hides an unverified lister's contacts, agency included, from signed-out visitors", () => {
    const visibility = contactVisibility({ listerVerified: false, viewerSignedIn: false });
    expect(visibility).toBe("hidden");
    expect(visibleContact(contact, visibility)).toEqual(NO_CONTACT);
  });

  it("shows an unverified lister's contacts to a signed-in visitor without an inquiry", () => {
    const visibility = contactVisibility({ listerVerified: false, viewerSignedIn: true });
    expect(visibility).toBe("signed_in");
    expect(visibleContact(contact, visibility)).toEqual(contact);
  });

  it("drops an agency that has no contacts", () => {
    const empty = { lister, agency: { name: "Quiet Agency", phone: null, whatsapp: null, email: null } };
    expect(visibleContact(empty, "public").agency).toBeNull();
  });

  it("dials the agent's numbers, or the office's when the agent gave none", () => {
    expect(primaryContact(contact)).toBe(lister);
    const noAgentContacts = { lister: { phone: null, whatsapp: null, email: null }, agency };
    expect(primaryContact(noAgentContacts)).toBe(agency);
    expect(primaryContact(NO_CONTACT)).toEqual({ phone: null, whatsapp: null, email: null });
  });
});
