import { describe, expect, it } from "vitest";
import { providerCode } from "./log-safe";

describe("providerCode (prompt S21 decision 5)", () => {
  it("keeps the leading code of provider failures", () => {
    expect(providerCode("400 400.002.02 Bad Request - Invalid PhoneNumber")).toBe("400 400.002.02");
    expect(providerCode("HTTP 401 Invalid key")).toBe("HTTP 401");
    expect(providerCode("response 1")).toBe("response 1");
    expect(providerCode("timeout")).toBe("timeout");
    expect(providerCode("at_403")).toBe("at_403");
  });

  it("stops at anything that could be personal data", () => {
    expect(providerCode("jane@example.com rejected")).toBe("unknown");
    expect(providerCode("HTTP 400 jane@example.com")).toBe("HTTP 400");
    expect(providerCode("number 254712345678 invalid")).toBe("number");
    expect(providerCode("")).toBe("unknown");
    expect(providerCode(undefined)).toBe("unknown");
  });
});
