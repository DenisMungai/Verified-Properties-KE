import { describe, expect, it } from "vitest";
import { dayLabel, formatNairobiTime, inboxTime } from "./format";

// 2026-11-08 09:00 in Nairobi (UTC+3).
const now = new Date("2026-11-08T06:00:00Z");

describe("message times", () => {
  it("shows Nairobi time, 24-hour", () => {
    expect(formatNairobiTime(new Date("2026-11-08T11:05:00Z"))).toBe("14:05");
  });

  it("uses the time for today and the date otherwise, by the Nairobi day", () => {
    expect(inboxTime(new Date("2026-11-07T21:30:00Z"), now)).toBe("00:30"); // 00:30 on the 8th in Nairobi
    expect(inboxTime(new Date("2026-11-07T20:30:00Z"), now)).toBe("7 Nov 2026");
  });

  it("labels days Today, Yesterday or the date", () => {
    expect(dayLabel(new Date("2026-11-08T01:00:00Z"), now)).toBe("Today");
    expect(dayLabel(new Date("2026-11-07T10:00:00Z"), now)).toBe("Yesterday");
    expect(dayLabel(new Date("2026-11-05T10:00:00Z"), now)).toBe("5 Nov 2026");
  });
});
