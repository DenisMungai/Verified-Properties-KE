import { describe, expect, it } from "vitest";
import { makeSlug } from "./slug";

describe("makeSlug", () => {
  it("lower-cases, strips punctuation and accents, and appends the suffix", () => {
    expect(makeSlug("Bright 2-Bedroom Flat, Kilimani!", "a1b2c3")).toBe("bright-2-bedroom-flat-kilimani-a1b2c3");
    expect(makeSlug("Café near Nyali Beach", "000000")).toBe("cafe-near-nyali-beach-000000");
  });

  it("caps the base at 60 characters without a trailing dash", () => {
    const slug = makeSlug(`${"a".repeat(59)} bbbb`, "ffffff");
    expect(slug).toBe(`${"a".repeat(59)}-ffffff`);
  });

  it("falls back when the title has no usable characters", () => {
    expect(makeSlug("!!!", "abcdef")).toBe("property-abcdef");
  });

  it("uses a random 6-hex suffix by default", () => {
    expect(makeSlug("Plot in Syokimau")).toMatch(/^plot-in-syokimau-[0-9a-f]{6}$/);
    expect(makeSlug("Plot in Syokimau")).not.toBe(makeSlug("Plot in Syokimau"));
  });
});
