import { describe, expect, it } from "vitest";
import { safeNextPath, signInPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it.each(["/account", "/account/settings", "/properties?county=Nairobi&page=2", "/a#section"])(
    "keeps same-origin path %j",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    ["protocol-relative", "//evil.com"],
    ["backslash", "/\\evil.com"],
    ["absolute https", "https://evil.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["encoded double slash", "%2F%2Fevil.com"],
    ["encoded backslash", "/%5Cevil.com"],
    ["tab trick", "/\t/evil.com"],
    ["relative without slash", "account"],
    ["empty", ""],
    ["too long", `/${"a".repeat(600)}`],
    ["malformed encoding", "/%E0%A4%A"],
  ])("rejects %s", (_label, value) => {
    expect(safeNextPath(value)).toBe("/account");
  });

  it("rejects non-strings and honours a custom fallback", () => {
    expect(safeNextPath(undefined)).toBe("/account");
    expect(safeNextPath(["/account"], "/")).toBe("/");
  });
});

describe("signInPath", () => {
  it("adds an encoded next parameter", () => {
    expect(signInPath("/account/settings")).toBe("/sign-in?next=%2Faccount%2Fsettings");
  });

  it("omits next for the default destination or an unsafe one", () => {
    expect(signInPath("/account")).toBe("/sign-in");
    expect(signInPath("//evil.com")).toBe("/sign-in");
  });
});
