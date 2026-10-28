import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const DB = "postgres://user:s3cret-value@host-pooler.neon.tech/db";

describe("parseServerEnv", () => {
  it("accepts a minimal configuration and applies defaults", () => {
    const env = parseServerEnv({ DATABASE_URL: DB });
    expect(env.DATABASE_URL).toBe(DB);
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.MPESA_ENV).toBe("sandbox");
  });

  it("treats empty strings as unset", () => {
    const env = parseServerEnv({ DATABASE_URL: DB, RESEND_API_KEY: "", R2_PUBLIC_BASE_URL: "" });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.R2_PUBLIC_BASE_URL).toBeUndefined();
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseServerEnv({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("names invalid variables without printing their values", () => {
    const secret = "too-short-secret-value";
    let message = "";
    try {
      parseServerEnv({ DATABASE_URL: DB, BETTER_AUTH_SECRET: secret, MPESA_ENV: "live" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/BETTER_AUTH_SECRET/);
    expect(message).toMatch(/MPESA_ENV/);
    expect(message).not.toContain(secret);
    expect(message).not.toContain("s3cret-value");
  });

  it("validates the M-Pesa shortcode format", () => {
    expect(() => parseServerEnv({ DATABASE_URL: DB, MPESA_SHORTCODE: "abc" })).toThrow(
      /MPESA_SHORTCODE/,
    );
    expect(parseServerEnv({ DATABASE_URL: DB, MPESA_SHORTCODE: "174379" }).MPESA_SHORTCODE).toBe(
      "174379",
    );
  });
});
