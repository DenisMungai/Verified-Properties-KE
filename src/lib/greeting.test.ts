import { describe, expect, it } from "vitest";
import { greetingFor } from "./greeting";

describe("greetingFor", () => {
  // Nairobi is UTC+3 all year.
  it.each([
    ["2026-10-28T02:00:00Z", "Good morning"], // 05:00
    ["2026-10-28T08:59:00Z", "Good morning"], // 11:59
    ["2026-10-28T09:00:00Z", "Good afternoon"], // 12:00
    ["2026-10-28T14:00:00Z", "Good evening"], // 17:00
    ["2026-10-28T20:30:00Z", "Good evening"], // 23:30
    ["2026-10-28T01:00:00Z", "Good evening"], // 04:00
  ])("%s -> %s", (iso, expected) => {
    expect(greetingFor(new Date(iso))).toBe(expected);
  });
});
