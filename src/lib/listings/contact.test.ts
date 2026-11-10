/**
 * The contact rule (plan §6 "Contact"; §12 "public APIs never expose … private columns"):
 * verified listers' phones are public, others stay hidden until the viewer has inquired, and an
 * email is never shown without an inquiry.
 */
import { describe, expect, it } from "vitest";
import { contactVisibility, visibleContact } from "./contact";

const contact = { phone: "+254712000111", email: "lister@example.test" };

describe("contact rule", () => {
  it("hides an unverified lister's details until the viewer inquires", () => {
    const visibility = contactVisibility({ listerVerified: false, viewerHasInquired: false });
    expect(visibility).toBe("hidden");
    expect(visibleContact(contact, visibility)).toEqual({ phone: null, email: null });
  });

  it("shows a verified lister's phone, but not their email, before an inquiry", () => {
    const visibility = contactVisibility({ listerVerified: true, viewerHasInquired: false });
    expect(visibility).toBe("public");
    expect(visibleContact(contact, visibility)).toEqual({ phone: contact.phone, email: null });
  });

  it("shows phone and email after the viewer's own inquiry, verified or not", () => {
    for (const listerVerified of [true, false]) {
      const visibility = contactVisibility({ listerVerified, viewerHasInquired: true });
      expect(visibility).toBe("after_inquiry");
      expect(visibleContact(contact, visibility)).toEqual(contact);
    }
  });
});
