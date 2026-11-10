import { describe, expect, it } from "vitest";
import { DATA_REQUEST_DETAILS_MAX, DATA_REQUEST_KINDS, requestReference, responseTargetFor } from "@/lib/legal";
import { POLICIES, createMemoryLimiter } from "@/lib/rate-limit";
import { closeDataRequestSchema, dataRequestSchema } from "./data-request";

describe("data request validation (prompt S20 decision 7)", () => {
  it("accepts every kind with real details, trimmed", () => {
    for (const kind of DATA_REQUEST_KINDS) {
      expect(dataRequestSchema.parse({ kind, details: "  Please send me my data.  " })).toEqual({ kind, details: "Please send me my data." });
    }
  });

  it("refuses unknown kinds, short and over-long details", () => {
    expect(dataRequestSchema.safeParse({ kind: "export", details: "A long enough request." }).success).toBe(false);
    expect(dataRequestSchema.safeParse({ kind: "access", details: "   short   " }).error?.issues[0].message).toMatch(/at least 10/);
    expect(dataRequestSchema.safeParse({ kind: "access", details: "x".repeat(DATA_REQUEST_DETAILS_MAX + 1) }).success).toBe(false);
    expect(dataRequestSchema.safeParse({ details: "A long enough request." }).error?.issues[0].message).toBe("Choose what you want to do.");
  });

  it("needs a request id and a note to close", () => {
    expect(closeDataRequestSchema.safeParse({ requestId: "not-a-uuid", note: "Done" }).success).toBe(false);
    expect(closeDataRequestSchema.safeParse({ requestId: "00000000-0000-4000-8000-000000000000", note: "   " }).success).toBe(false);
    expect(closeDataRequestSchema.parse({ requestId: "00000000-0000-4000-8000-000000000000", note: " Done " }).note).toBe("Done");
  });

  it("shows a short reference and the right response target", () => {
    expect(requestReference("1a2b3c4d-0000-4000-8000-000000000000")).toBe("1A2B3C4D");
    expect(responseTargetFor("billing")).toBe("2 working days");
    expect(responseTargetFor("deletion")).toBe("7 days");
  });

  it("allows 3 requests a day per user and refuses the 4th", async () => {
    const limiter = createMemoryLimiter(() => 0);
    for (let i = 0; i < 3; i++) expect((await limiter.limit(POLICIES.dataRequestPerUser, "user-a")).ok).toBe(true);
    expect((await limiter.limit(POLICIES.dataRequestPerUser, "user-a")).ok).toBe(false);
    expect((await limiter.limit(POLICIES.dataRequestPerUser, "user-b")).ok).toBe(true);
  });
});
