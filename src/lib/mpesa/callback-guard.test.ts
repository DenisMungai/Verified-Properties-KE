import { describe, expect, it } from "vitest";
import { DEFAULT_SAFARICOM_RANGES, ipAllowed, normalizeIp, parseCidrs, requestIp, tokenMatches } from "./callback-guard";

describe("tokenMatches", () => {
  it("accepts only the exact token", () => {
    expect(tokenMatches("a".repeat(32), "a".repeat(32))).toBe(true);
    expect(tokenMatches("a".repeat(31), "a".repeat(32))).toBe(false);
    expect(tokenMatches("", "a".repeat(32))).toBe(false);
  });
});

describe("IP allowlist", () => {
  const ranges = parseCidrs(DEFAULT_SAFARICOM_RANGES);

  it("allows addresses inside the ranges", () => {
    expect(ipAllowed("196.201.214.200", ranges)).toBe(true);
    expect(ipAllowed("196.201.212.127", ranges)).toBe(true);
  });

  it("refuses addresses outside, malformed or missing", () => {
    expect(ipAllowed("196.201.215.1", ranges)).toBe(false);
    expect(ipAllowed("127.0.0.1", ranges)).toBe(false);
    expect(ipAllowed("::1", ranges)).toBe(false);
    expect(ipAllowed("not-an-ip", ranges)).toBe(false);
    expect(ipAllowed(null, ranges)).toBe(false);
  });

  it("understands IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:196.201.214.200")).toBe("196.201.214.200");
    expect(ipAllowed("::FFFF:196.201.213.9", ranges)).toBe(true);
  });

  it("treats a bare address as /32 and supports /0", () => {
    expect(ipAllowed("10.0.0.1", parseCidrs("10.0.0.1"))).toBe(true);
    expect(ipAllowed("10.0.0.2", parseCidrs("10.0.0.1"))).toBe(false);
    expect(ipAllowed("8.8.8.8", parseCidrs("0.0.0.0/0"))).toBe(true);
  });

  it("rejects malformed CIDRs", () => {
    expect(() => parseCidrs("196.201.214.0/33")).toThrow();
    expect(() => parseCidrs("196.201.214/24")).toThrow();
    expect(() => parseCidrs("300.1.1.1")).toThrow();
  });
});

describe("requestIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(requestIp(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }))).toBe("1.2.3.4");
    expect(requestIp(new Headers({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" }))).toBe("5.6.7.8");
    expect(requestIp(new Headers())).toBeNull();
  });
});
