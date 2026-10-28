import { describe, expect, it } from "vitest";
import {
  formatAreaSqm,
  formatKes,
  formatKesCompact,
  formatLandSize,
  formatNairobiDate,
  formatNairobiDateTime,
} from "./format";

describe("formatKes", () => {
  it("formats whole shillings with grouping", () => {
    expect(formatKes(45_000_000)).toBe("KSh 45,000,000");
    expect(formatKes(1_250)).toBe("KSh 1,250");
  });

  it("formats zero", () => {
    expect(formatKes(0)).toBe("KSh 0");
  });

  it("rejects fractions and negatives", () => {
    expect(() => formatKes(1.5)).toThrow(RangeError);
    expect(() => formatKes(-1)).toThrow(RangeError);
    expect(() => formatKes(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatKesCompact", () => {
  it("keeps small amounts exact", () => {
    expect(formatKesCompact(9_500)).toBe("KSh 9,500");
  });

  it("abbreviates thousands, millions and billions", () => {
    expect(formatKesCompact(850_000)).toBe("KSh 850K");
    expect(formatKesCompact(45_000_000)).toBe("KSh 45M");
    expect(formatKesCompact(12_500_000)).toBe("KSh 12.5M");
    expect(formatKesCompact(1_200_000_000)).toBe("KSh 1.2B");
  });
});

describe("Nairobi dates", () => {
  // 22:30 UTC on 27 Oct is 01:30 on 28 Oct in Nairobi (UTC+3).
  const lateUtc = new Date("2026-10-27T22:30:00Z");

  it("uses Nairobi time across the UTC day boundary", () => {
    expect(formatNairobiDate(lateUtc)).toBe("28 Oct 2026");
  });

  it("formats date and 24-hour time", () => {
    expect(formatNairobiDateTime(lateUtc)).toBe("28 Oct 2026, 01:30");
  });
});

describe("area formatting", () => {
  it("labels built area in square metres", () => {
    expect(formatAreaSqm(120)).toBe("120 m²");
    expect(formatAreaSqm(85.5)).toBe("85.5 m²");
  });

  it("labels land size with a singular or plural unit", () => {
    expect(formatLandSize(1, "acre")).toBe("1 acre");
    expect(formatLandSize(0.5, "acre")).toBe("0.5 acres");
    expect(formatLandSize(2, "hectare")).toBe("2 hectares");
    expect(formatLandSize(450, "sqm")).toBe("450 m²");
  });
});
