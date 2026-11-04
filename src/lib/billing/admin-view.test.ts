import { describe, expect, it } from "vitest";
import { parseReconciliationReport } from "./admin-view";

const fallback = new Date("2026-11-04T00:00:00Z");

describe("parseReconciliationReport", () => {
  it("reads the S9 payload", () => {
    const report = parseReconciliationReport(
      {
        ranAt: "2026-11-03T22:00:00.000Z",
        checks: { flagged_open: { count: 2, ids: ["a", "b"] }, multiple_payments: { count: 1, ids: ["VPK0000001"] } },
        dailyTotals: {
          from: "2026-11-02T21:00:00.000Z",
          to: "2026-11-03T21:00:00.000Z",
          byMethod: [{ method: "stk_push", count: 3, amountKes: 4500 }],
        },
      },
      fallback,
    );
    expect(report.ranAt.toISOString()).toBe("2026-11-03T22:00:00.000Z");
    expect(report.checks.find((c) => c.name === "flagged_open")).toMatchObject({ count: 2, ids: ["a", "b"], idKind: "payment" });
    expect(report.checks.find((c) => c.name === "multiple_payments")).toMatchObject({ count: 1, idKind: "invoice" });
    expect(report.checks.find((c) => c.name === "stuck_pending")).toMatchObject({ count: 0, ids: [] });
    expect(report.totals?.byMethod).toEqual([{ method: "stk_push", count: 3, amountKes: 4500 }]);
  });

  it("shows a malformed payload as zeros", () => {
    const report = parseReconciliationReport({ checks: { flagged_open: { count: "lots", ids: [1, "x"] } } }, fallback);
    expect(report.ranAt).toBe(fallback);
    expect(report.checks.find((c) => c.name === "flagged_open")).toMatchObject({ count: 0, ids: ["x"] });
    expect(report.totals).toBeNull();
    expect(parseReconciliationReport(null, fallback).checks.every((c) => c.count === 0)).toBe(true);
  });
});
