import { describe, expect, it } from "vitest";
import { mailtoHref, telHref, whatsappHref } from "./contact-links";

const listing = { title: `3 bed "garden" flat & pool 🏡`, url: "https://example.test/properties/3-bed-garden-flat" };

describe("contact links", () => {
  it("dials the stored E.164 number", () => {
    expect(telHref("+254712345678")).toBe("tel:+254712345678");
    expect(telHref("0712345678")).toBeNull();
  });

  it("opens WhatsApp without the plus, with an encoded message about the listing", () => {
    const href = whatsappHref("+254712345678", listing);
    expect(href).not.toBeNull();
    const url = new URL(href!);
    expect(url.origin + url.pathname).toBe("https://wa.me/254712345678");
    expect(url.searchParams.get("text")).toBe(
      `Hi, I'm interested in "3 bed "garden" flat & pool 🏡" on VerifiedPropertiesKE: https://example.test/properties/3-bed-garden-flat`,
    );
    expect(href).not.toMatch(/[ "&]pool/);
  });

  it("refuses a WhatsApp number that isn't E.164", () => {
    expect(whatsappHref("712345678", listing)).toBeNull();
  });

  it("drafts an email with the listing in the subject and its link in the body", () => {
    const href = mailtoHref("agent+homes@example.test", listing);
    expect(href.startsWith("mailto:agent%2Bhomes@example.test?")).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toBe(`Enquiry: ${listing.title}`);
    expect(params.get("body")).toContain(listing.url);
  });
});
