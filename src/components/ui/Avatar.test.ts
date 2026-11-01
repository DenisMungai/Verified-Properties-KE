import { describe, expect, it } from "vitest";
import { initialsOf } from "./Avatar";

describe("initialsOf", () => {
  it("takes the first and last word's initials, upper-cased", () => {
    expect(initialsOf("Greenstone Realty")).toBe("GR");
    expect(initialsOf("  denis   kamau mungai ")).toBe("DM");
    expect(initialsOf("Wanjiku")).toBe("W");
    expect(initialsOf("")).toBe("");
  });
});
