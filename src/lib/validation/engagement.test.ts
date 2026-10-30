import { describe, expect, it } from "vitest";
import { contactVisibility, visibleContact } from "@/lib/listings/contact";
import { DEFAULT_INQUIRY_MESSAGE, PHONE_ERROR, decisionReasonSchema, inquirySchema, reportSchema } from "./engagement";

const valid = { fullName: "Amina Otieno", phone: "0712 345 678", email: "", message: DEFAULT_INQUIRY_MESSAGE };

describe("inquirySchema", () => {
  it("normalises the phone and blanks a missing email", () => {
    const parsed = inquirySchema.parse(valid);
    expect(parsed).toEqual({ fullName: "Amina Otieno", phone: "+254712345678", email: null, message: DEFAULT_INQUIRY_MESSAGE });
  });

  it("accepts an email instead of a phone", () => {
    expect(inquirySchema.parse({ ...valid, phone: "", email: " Amina@Example.com " })).toMatchObject({
      phone: null,
      email: "amina@example.com",
    });
  });

  it("needs a phone or an email", () => {
    const result = inquirySchema.safeParse({ ...valid, phone: "", email: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["phone"] });
  });

  it("rejects a non-Kenyan phone, a bad email and short or long messages", () => {
    const issues = (input: object) => inquirySchema.safeParse({ ...valid, ...input }).error?.issues.map((i) => i.message) ?? [];
    expect(issues({ phone: "+44 20 7946 0958" })).toContain(PHONE_ERROR);
    expect(issues({ email: "not-an-email" })).toHaveLength(1);
    expect(issues({ message: "Hi" })).toHaveLength(1);
    expect(issues({ message: "x".repeat(2001) })).toHaveLength(1);
  });

  it("ignores keys it doesn't know (recipient, status)", () => {
    const parsed = inquirySchema.parse({ ...valid, recipientUserId: "someone", status: "read" });
    expect(Object.keys(parsed).sort()).toEqual(["email", "fullName", "message", "phone"]);
  });
});

describe("reportSchema", () => {
  it("takes a known reason and optional details", () => {
    expect(reportSchema.parse({ reason: "scam", details: "  " })).toEqual({ reason: "scam", details: null });
    expect(reportSchema.safeParse({ reason: "boring", details: "" }).success).toBe(false);
    expect(reportSchema.safeParse({ reason: "other", details: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("decisionReasonSchema", () => {
  it("needs 10 to 500 characters", () => {
    expect(decisionReasonSchema.safeParse("Too short").success).toBe(false);
    expect(decisionReasonSchema.parse("  Photos show a different property.  ")).toBe("Photos show a different property.");
    expect(decisionReasonSchema.safeParse("x".repeat(501)).success).toBe(false);
  });
});

describe("contact rule", () => {
  const contact = { phone: "+254712345678", email: "lister@example.com" };

  it("shows a verified lister's phone to everyone, but not their email", () => {
    const visibility = contactVisibility({ listerVerified: true, viewerHasInquired: false });
    expect(visibility).toBe("public");
    expect(visibleContact(contact, visibility)).toEqual({ phone: contact.phone, email: null });
  });

  it("shows an unverified lister's details only after this viewer's inquiry", () => {
    expect(visibleContact(contact, contactVisibility({ listerVerified: false, viewerHasInquired: false }))).toEqual({
      phone: null,
      email: null,
    });
    expect(visibleContact(contact, contactVisibility({ listerVerified: false, viewerHasInquired: true }))).toEqual(contact);
  });

  it("gives an inquirer everything, verified or not", () => {
    expect(contactVisibility({ listerVerified: true, viewerHasInquired: true })).toBe("after_inquiry");
  });
});
