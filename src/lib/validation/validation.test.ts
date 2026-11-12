import { describe, expect, it } from "vitest";
import { changePasswordSchema, resetPasswordSchema, signInSchema, signUpSchema } from "./auth";
import { agencyContactSchema } from "./agency-contact";
import { listerProfileSchema } from "./profile";

describe("signUpSchema", () => {
  const valid = { name: "  Wanjiru Kamau ", email: " Wanjiru@Example.COM ", password: "correct-horse-9", intent: "list" };

  it("normalises name and email", () => {
    const parsed = signUpSchema.parse(valid);
    expect(parsed.name).toBe("Wanjiru Kamau");
    expect(parsed.email).toBe("wanjiru@example.com");
  });

  it("enforces password length 10-128", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "short-pw1" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: "x".repeat(129) }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: "x".repeat(10) }).success).toBe(true);
  });

  it("only accepts the two intents and drops unknown fields such as role", () => {
    expect(signUpSchema.safeParse({ ...valid, intent: "admin" }).success).toBe(false);
    const parsed = signUpSchema.parse({ ...valid, role: "platform_admin", emailVerified: true });
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("emailVerified");
  });

  it("rejects an invalid email with a helpful message", () => {
    const result = signUpSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/valid email/);
  });
});

describe("signInSchema", () => {
  it("does not apply new-password rules to existing passwords", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "old" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("password change and reset", () => {
  it("requires matching confirmation", () => {
    const result = resetPasswordSchema.safeParse({
      token: "t",
      password: "new-password-1",
      confirmPassword: "new-password-2",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["confirmPassword"]);
  });

  it("rejects reusing the current password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "same-password-1",
      newPassword: "same-password-1",
      confirmPassword: "same-password-1",
    });
    expect(result.success).toBe(false);
  });
});

describe("listerProfileSchema", () => {
  const valid = {
    listerType: "agent",
    displayName: " Amani Homes ",
    phone: "0712 345 678",
    publicEmail: "",
    bio: "",
  };

  it("normalises the phone to E.164 and blanks to null", () => {
    expect(listerProfileSchema.parse(valid)).toEqual({
      listerType: "agent",
      displayName: "Amani Homes",
      phone: "+254712345678",
      whatsapp: null,
      publicEmail: null,
      bio: null,
    });
  });

  it("uses the phone for WhatsApp when the box is ticked, ignoring the WhatsApp field", () => {
    const parsed = listerProfileSchema.parse({ ...valid, whatsappSameAsPhone: "on", whatsapp: "not a number" });
    expect(parsed.whatsapp).toBe("+254712345678");
  });

  it("takes a separate WhatsApp number, and rejects a bad one on the WhatsApp field", () => {
    expect(listerProfileSchema.parse({ ...valid, whatsapp: "0110 222 333" }).whatsapp).toBe("+254110222333");
    const result = listerProfileSchema.safeParse({ ...valid, whatsapp: "12345" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["whatsapp"]);
  });

  it("rejects non-Kenyan or non-mobile numbers", () => {
    const result = listerProfileSchema.safeParse({ ...valid, phone: "0812345678" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["phone"]);
  });

  it("rejects unknown lister types and ignores forged privileged fields", () => {
    expect(listerProfileSchema.safeParse({ ...valid, listerType: "platform_admin" }).success).toBe(false);
    const parsed = listerProfileSchema.parse({ ...valid, role: "platform_admin", agencyId: "x" });
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("agencyId");
  });

  it("validates an optional public email", () => {
    expect(listerProfileSchema.safeParse({ ...valid, publicEmail: "nope" }).success).toBe(false);
    expect(listerProfileSchema.parse({ ...valid, publicEmail: "Sales@Amani.co.ke" }).publicEmail).toBe(
      "sales@amani.co.ke",
    );
  });
});

describe("agencyContactSchema", () => {
  it("accepts all blanks as no office contacts", () => {
    expect(agencyContactSchema.parse({ phone: "", whatsapp: "", email: "" })).toEqual({ phone: null, whatsapp: null, email: null });
  });

  it("normalises numbers and email, and copies the phone to WhatsApp when ticked", () => {
    expect(agencyContactSchema.parse({ phone: "+254 722 000 111", whatsappSameAsPhone: "on", email: " Office@Example.TEST " })).toEqual({
      phone: "+254722000111",
      whatsapp: "+254722000111",
      email: "office@example.test",
    });
  });

  it("flags a bad office phone, WhatsApp or email on its own field", () => {
    const paths = (input: Record<string, string>) => agencyContactSchema.safeParse(input).error?.issues.map((issue) => issue.path[0]);
    expect(paths({ phone: "020 123 4567", email: "" })).toEqual(["phone"]);
    expect(paths({ phone: "", whatsapp: "999", email: "" })).toEqual(["whatsapp"]);
    expect(paths({ phone: "", email: "nope" })).toEqual(["email"]);
  });

  it("ignores fields it doesn't know, such as an agency id", () => {
    expect(agencyContactSchema.parse({ phone: "", email: "", agencyId: "other" })).not.toHaveProperty("agencyId");
  });
});
