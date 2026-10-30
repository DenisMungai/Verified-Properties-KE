import { describe, expect, it } from "vitest";
import { cardFacts, cardImageAlt } from "./card";
import { SCORE_WEIGHTS, nairobiDateSeed } from "./ranking";

describe("nairobiDateSeed", () => {
  it("uses the Nairobi calendar date (UTC+3)", () => {
    expect(nairobiDateSeed(new Date("2026-10-30T20:59:59Z"))).toBe("2026-10-30");
    expect(nairobiDateSeed(new Date("2026-10-30T21:00:00Z"))).toBe("2026-10-31");
  });

  it("is stable within a day", () => {
    expect(nairobiDateSeed(new Date("2026-10-29T21:00:00Z"))).toBe(nairobiDateSeed(new Date("2026-10-30T20:00:00Z")));
  });
});

describe("score weights", () => {
  it("sum to 1, so the score stays in [0, 1]", () => {
    const total = SCORE_WEIGHTS.match + SCORE_WEIGHTS.recency + SCORE_WEIGHTS.quality;
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("cardFacts", () => {
  const home = {
    category: "apartment" as const,
    bedrooms: 3,
    bathrooms: 2,
    areaSqm: 140,
    landSize: null,
    landSizeUnit: null,
    parkingSpaces: 1,
  };

  it("shows beds, baths and parking for homes", () => {
    expect(cardFacts(home)).toEqual(["3 beds", "2 baths", "1 parking"]);
    expect(cardFacts({ ...home, bedrooms: 0, bathrooms: 1.5, parkingSpaces: null })).toEqual(["Studio", "1.5 baths"]);
  });

  it("shows the land size for land and the floor area for commercial", () => {
    expect(
      cardFacts({ ...home, category: "land", bedrooms: null, bathrooms: null, landSize: 0.5, landSizeUnit: "acre" }),
    ).toEqual(["0.5 acres"]);
    expect(cardFacts({ ...home, category: "commercial", bedrooms: null, bathrooms: null, parkingSpaces: 4 })).toEqual([
      "140 m²",
      "4 parking",
    ]);
  });
});

describe("cardImageAlt", () => {
  it("prefers the cover's alt text", () => {
    expect(cardImageAlt({ coverAlt: "Living room", category: "house", town: "Ruiru" })).toBe("Living room");
    expect(cardImageAlt({ coverAlt: null, category: "house", town: "Ruiru" })).toBe("House in Ruiru");
  });
});
