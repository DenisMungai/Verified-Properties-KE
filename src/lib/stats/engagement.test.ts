import { describe, expect, it } from "vitest";
import { changeLabel, comparisonWindows, nairobiDay, percentChange, perDay, viewsTrackedFrom } from "./engagement";

describe("nairobiDay (S13 decision 12)", () => {
  it("counts by the Nairobi calendar day (UTC+3)", () => {
    expect(nairobiDay(new Date("2026-11-06T20:59:59Z"))).toBe("2026-11-06");
    expect(nairobiDay(new Date("2026-11-06T21:00:00Z"))).toBe("2026-11-07");
  });

  it("knows when views started being tracked", () => {
    expect(viewsTrackedFrom(new Date("2026-11-05T21:00:00Z"))).toBe(true);
    expect(viewsTrackedFrom(new Date("2026-11-05T20:59:59Z"))).toBe(false);
  });
});

describe("percentChange and changeLabel", () => {
  it("rounds up, down and flat", () => {
    expect(percentChange(112, 100)).toEqual({ kind: "up", percent: 12 });
    expect(percentChange(95, 100)).toEqual({ kind: "down", percent: 5 });
    expect(percentChange(100, 100)).toEqual({ kind: "flat" });
  });

  it("has no baseline when nothing came before", () => {
    expect(percentChange(4, 0)).toEqual({ kind: "no_baseline" });
    expect(percentChange(0, 0)).toEqual({ kind: "flat" });
  });

  it("labels with a sign and the period", () => {
    expect(changeLabel({ kind: "up", percent: 12 }, "previous 30 days")).toBe("+12% vs previous 30 days");
    expect(changeLabel({ kind: "down", percent: 5 }, "previous 30 days")).toBe("−5% vs previous 30 days");
    expect(changeLabel({ kind: "flat" }, "previous 30 days")).toBe("Same as previous 30 days");
    expect(changeLabel({ kind: "no_baseline" }, "previous 30 days")).toBeNull();
  });

  it("averages per day", () => {
    expect(perDay(10, 3)).toBe(3.3);
    expect(perDay(5, 0)).toBe(0);
  });
});

describe("comparisonWindows", () => {
  const approved = new Date("2026-10-01T00:00:00Z");

  it("waits 7 days after the first approval", () => {
    expect(comparisonWindows(approved, new Date("2026-10-07T23:00:00Z"))).toBeNull();
  });

  it("compares 30 days before with up to the last 30 days", () => {
    const short = comparisonWindows(approved, new Date("2026-10-11T00:00:00Z"));
    expect(short?.before.days).toBe(30);
    expect(short?.before.to).toEqual(approved);
    expect(short?.after.days).toBe(10);
    expect(comparisonWindows(approved, new Date("2027-01-01T00:00:00Z"))?.after.days).toBe(30);
  });
});
