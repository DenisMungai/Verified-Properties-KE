import { describe, expect, it } from "vitest";
import { MAX_LINKS, MESSAGE_MAX, countLinks, hasLink, messageReportSchema, messageSchema } from "./messaging";

describe("countLinks", () => {
  it("counts http(s), www and bare domains with common TLDs once each", () => {
    expect(countLinks("see https://example.com/pay and http://x.org")).toBe(2);
    expect(countLinks("www.deal.co.ke now")).toBe(1);
    expect(countLinks("pay at pay-deposit.co.ke/x today")).toBe(1);
    expect(countLinks("https://www.example.com")).toBe(1);
  });

  it("ignores email addresses, prices, decimals and ordinary sentences", () => {
    expect(countLinks("Email me at jane@gmail.com please")).toBe(0);
    expect(countLinks("It's KES 3.5m, about 2.5 acres. Ok.")).toBe(0);
    expect(countLinks("Hi, is it still available? Thanks.")).toBe(0);
    expect(hasLink("call 0712 345 678")).toBe(false);
  });
});

describe("messageSchema", () => {
  it("trims and accepts 1–2000 characters", () => {
    expect(messageSchema.parse("  Hello  ")).toBe("Hello");
    expect(messageSchema.safeParse("   ").success).toBe(false);
    expect(messageSchema.safeParse("a".repeat(MESSAGE_MAX)).success).toBe(true);
    expect(messageSchema.safeParse("a".repeat(MESSAGE_MAX + 1)).success).toBe(false);
  });

  it(`allows up to ${MAX_LINKS} links and refuses more`, () => {
    expect(messageSchema.safeParse("a.com and b.com").success).toBe(true);
    const three = messageSchema.safeParse("a.com, b.com and https://c.org");
    expect(three.success).toBe(false);
    expect(three.error?.issues[0]?.message).toBe("Messages can include at most 2 links.");
  });
});

describe("messageReportSchema", () => {
  it("needs a known reason, keeps details optional and passes the block choice", () => {
    expect(messageReportSchema.parse({ reason: "spam", details: "  ", block: true })).toEqual({ reason: "spam", details: null, block: true });
    expect(messageReportSchema.safeParse({ reason: "wrong_details", details: "", block: false }).success).toBe(false);
  });
});
