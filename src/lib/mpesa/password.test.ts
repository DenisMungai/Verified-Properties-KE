import { describe, expect, it } from "vitest";
import { darajaTimestamp, stkPassword } from "./password";

describe("darajaTimestamp", () => {
  it("formats Nairobi local time (UTC+3) as YYYYMMDDHHmmss", () => {
    expect(darajaTimestamp(new Date("2026-10-29T09:05:07Z"))).toBe("20261029120507");
  });

  it("rolls the date over at Nairobi midnight", () => {
    expect(darajaTimestamp(new Date("2026-12-31T21:30:00Z"))).toBe("20270101003000");
  });
});

describe("stkPassword", () => {
  it("is base64(shortcode + passkey + timestamp)", () => {
    const password = stkPassword("174379", "passkey", "20261029120507");
    expect(Buffer.from(password, "base64").toString()).toBe("174379passkey20261029120507");
  });
});
