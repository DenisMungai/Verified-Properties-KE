import { describe, expect, it } from "vitest";
import {
  KENYA_COUNTIES,
  displayKenyanPhone,
  maskPhone,
  normalizeKenyanPhone,
} from "./kenya";

describe("normalizeKenyanPhone", () => {
  const safaricom = { e164: "+254712345678", daraja: "254712345678" };
  const zeroOne = { e164: "+254112345678", daraja: "254112345678" };

  it.each([
    "0712345678",
    "0712 345 678",
    "0712-345-678",
    "712345678",
    "254712345678",
    "+254712345678",
    "+254 712 345 678",
    "(+254) 712.345.678",
    "  0712345678  ",
  ])("accepts %j", (input) => {
    expect(normalizeKenyanPhone(input)).toEqual(safaricom);
  });

  it.each(["0112345678", "112345678", "254112345678", "+254 112 345 678"])(
    "accepts 01xx form %j",
    (input) => {
      expect(normalizeKenyanPhone(input)).toEqual(zeroOne);
    },
  );

  it.each([
    ["non-mobile prefix", "0812345678"],
    ["landline", "0201234567"],
    ["too short", "071234567"],
    ["too long", "07123456789"],
    ["foreign country code", "+255712345678"],
    ["plus without country code", "+0712345678"],
    ["letters", "07I2345678"],
    ["empty", ""],
    ["double zero after 254", "2540712345678"],
  ])("rejects %s (%j)", (_label, input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });
});

describe("displayKenyanPhone", () => {
  it("groups an E.164 number", () => {
    expect(displayKenyanPhone("+254712345678")).toBe("+254 712 345 678");
  });

  it("returns unexpected input unchanged", () => {
    expect(displayKenyanPhone("12345")).toBe("12345");
  });
});

describe("maskPhone", () => {
  it("keeps the network digit and last three digits", () => {
    expect(maskPhone("+254712345678")).toBe("+254 7•• ••• 678");
    expect(maskPhone("254112345678")).toBe("+254 1•• ••• 678");
  });

  it("fully masks anything unexpected", () => {
    expect(maskPhone("0712345678")).toBe("••••••••");
    expect(maskPhone("")).toBe("••••••••");
  });
});

describe("KENYA_COUNTIES", () => {
  it("lists all 47 counties once", () => {
    expect(KENYA_COUNTIES).toHaveLength(47);
    expect(new Set(KENYA_COUNTIES).size).toBe(47);
  });
});
