import { describe, expect, it } from "vitest";
import { closedStatusFor, decideStkOutcome, isQueryStillProcessing } from "./result-codes";

describe("decideStkOutcome", () => {
  it("confirms only when callback and query both succeed", () => {
    expect(decideStkOutcome(0, 0)).toEqual({ action: "confirm" });
  });

  it("closes when both report a failure, as cancelled for 1032", () => {
    expect(decideStkOutcome(1032, 1032)).toEqual({ action: "close", status: "cancelled" });
    expect(decideStkOutcome(1, 1)).toEqual({ action: "close", status: "failed" });
    expect(decideStkOutcome(2001, 1032)).toEqual({ action: "close", status: "failed" });
  });

  it("flags when they disagree", () => {
    expect(decideStkOutcome(0, 1032)).toEqual({ action: "flag", reason: "callback_query_mismatch" });
    expect(decideStkOutcome(1, 0)).toEqual({ action: "flag", reason: "callback_query_mismatch" });
  });
});

describe("result helpers", () => {
  it("maps closed statuses", () => {
    expect(closedStatusFor(1032)).toBe("cancelled");
    expect(closedStatusFor(1037)).toBe("failed");
  });

  it("recognises still-processing query answers", () => {
    expect(isQueryStillProcessing({ errorCode: "500.001.1001" })).toBe(true);
    expect(isQueryStillProcessing({ resultCode: 4999 })).toBe(true);
    expect(isQueryStillProcessing({ resultCode: 0 })).toBe(false);
    expect(isQueryStillProcessing({ errorCode: "400.002.02" })).toBe(false);
  });
});
