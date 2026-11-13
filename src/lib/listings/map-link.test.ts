import { describe, expect, it } from "vitest";
import { MAP_URL_ERROR, MAP_URL_TOO_LONG, isGoogleMapsUrl, mapUrlHost, normalizeGoogleMapsUrl } from "./map-link";

const ok = (input: string) => normalizeGoogleMapsUrl(input);

describe("normalizeGoogleMapsUrl", () => {
  it("treats blank as no link", () => {
    expect(ok("")).toEqual({ ok: true, url: null });
    expect(ok("   ")).toEqual({ ok: true, url: null });
  });

  it.each([
    ["https://maps.app.goo.gl/AbC123xyz", "https://maps.app.goo.gl/AbC123xyz"],
    ["maps.app.goo.gl/AbC123", "https://maps.app.goo.gl/AbC123"],
    ["http://maps.app.goo.gl/AbC123", "https://maps.app.goo.gl/AbC123"],
    ["https://goo.gl/maps/Xyz987", "https://goo.gl/maps/Xyz987"],
    [
      "https://www.google.com/maps/place/Kilimani,+Nairobi/@-1.29,36.78,15z",
      "https://www.google.com/maps/place/Kilimani,+Nairobi/@-1.29,36.78,15z",
    ],
    ["https://google.com/maps?q=-1.29,36.78", "https://google.com/maps?q=-1.29,36.78"],
    ["https://www.google.co.ke/maps/@-1.29,36.78,15z", "https://www.google.co.ke/maps/@-1.29,36.78,15z"],
    ["https://maps.google.com/?q=-1.29,36.78", "https://maps.google.com/?q=-1.29,36.78"],
    ["https://MAPS.APP.GOO.GL/AbC", "https://maps.app.goo.gl/AbC"],
  ])("accepts %s", (input, expected) => {
    expect(ok(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    "https://evil.example/maps",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://google.com/search?q=x",
    "https://www.google.com/mapsfoo",
    "https://goo.gl/abc",
    "https://user:pw@maps.app.goo.gl/x",
    "https://maps.app.goo.gl:8443/x",
    "https://maps.app.goo.gl.evil.example/x",
    "ftp://maps.google.com/x",
    "not a url at all",
  ])("rejects %s", (input) => {
    expect(ok(input)).toEqual({ ok: false, error: MAP_URL_ERROR });
  });

  it("rejects links longer than 500 characters", () => {
    expect(ok(`https://www.google.com/maps/place/${"a".repeat(500)}`)).toEqual({ ok: false, error: MAP_URL_TOO_LONG });
  });
});

describe("isGoogleMapsUrl", () => {
  it("accepts only already-normalised allowed links", () => {
    expect(isGoogleMapsUrl("https://maps.app.goo.gl/AbC")).toBe(true);
    expect(isGoogleMapsUrl("maps.app.goo.gl/AbC")).toBe(false);
    expect(isGoogleMapsUrl("https://evil.example/maps")).toBe(false);
    expect(isGoogleMapsUrl(null)).toBe(false);
  });
});

describe("mapUrlHost", () => {
  it("shows the host without www", () => {
    expect(mapUrlHost("https://www.google.com/maps/@1,2,3z")).toBe("google.com");
    expect(mapUrlHost("https://maps.app.goo.gl/AbC")).toBe("maps.app.goo.gl");
  });
});
