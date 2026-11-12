import { describe, expect, it } from "vitest";
import { agencyDetailsSchema, createAgencySchema, inviteSchema, memberRoleChangeSchema } from "./agency";

describe("createAgencySchema", () => {
  it("trims the name and turns a blank description into null", () => {
    expect(createAgencySchema.parse({ name: "  Acme Realty ", description: "  " })).toEqual({ name: "Acme Realty", description: null });
  });

  it("refuses names that are too short or too long", () => {
    expect(createAgencySchema.safeParse({ name: "A", description: "" }).success).toBe(false);
    expect(createAgencySchema.safeParse({ name: "x".repeat(81), description: "" }).success).toBe(false);
    expect(createAgencySchema.safeParse({ name: "Acme", description: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("agencyDetailsSchema website", () => {
  const parse = (website: string) => agencyDetailsSchema.safeParse({ name: "Acme", description: "", website });

  it("accepts https addresses and adds https:// to a bare domain", () => {
    expect(parse("https://acme.co.ke/about").data?.website).toBe("https://acme.co.ke/about");
    expect(parse("acme.co.ke").data?.website).toBe("https://acme.co.ke/");
    expect(parse("").data?.website).toBeNull();
  });

  it("refuses other schemes, credentials and hostnames without a dot", () => {
    for (const bad of ["http://acme.co.ke", "javascript:alert(1)", "ftp://acme.co.ke", "https://user:pw@acme.co.ke", "localhost", "https://"]) {
      expect(parse(bad).success, bad).toBe(false);
    }
  });

  it("keeps addresses within the database limit", () => {
    expect(parse(`https://acme.co.ke/${"a".repeat(190)}`).success).toBe(false);
  });
});

describe("inviteSchema", () => {
  it("lower-cases the email and defaults the role to member", () => {
    expect(inviteSchema.parse({ email: " Wanjiru@Example.CO.KE " })).toEqual({ email: "wanjiru@example.co.ke", role: "member" });
  });

  it("refuses bad emails and unknown roles", () => {
    expect(inviteSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.co", role: "platform_admin" }).success).toBe(false);
  });
});

describe("memberRoleChangeSchema", () => {
  it("allows only admin or member, and plain user ids", () => {
    expect(memberRoleChangeSchema.safeParse({ userId: "abc_123-XYZ", role: "admin" }).success).toBe(true);
    expect(memberRoleChangeSchema.safeParse({ userId: "abc'; drop", role: "admin" }).success).toBe(false);
    expect(memberRoleChangeSchema.safeParse({ userId: "abc", role: "owner" }).success).toBe(false);
  });
});
