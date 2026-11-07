import { describe, expect, it } from "vitest";
import { CARD_CANCEL_BLOCK_MINUTES, IN_FLIGHT_SECONDS } from "./constants";
import { canHideInvoice, invoiceHasMoney, paymentInProgress, type InvoicePaymentFact } from "./invoice-rules";

const now = new Date("2026-11-07T10:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const pay = (over: Partial<InvoicePaymentFact>): InvoicePaymentFact => ({
  method: "stk_push",
  status: "pending",
  createdAt: now,
  ...over,
});

describe("paymentInProgress", () => {
  it("blocks while an STK push is in flight, then releases", () => {
    expect(paymentInProgress([pay({ createdAt: ago(IN_FLIGHT_SECONDS * 1000 - 1) })], now)).toBe(true);
    expect(paymentInProgress([pay({ createdAt: ago(IN_FLIGHT_SECONDS * 1000) })], now)).toBe(false);
  });

  it("blocks a recent pending card checkout for longer", () => {
    const window = CARD_CANCEL_BLOCK_MINUTES * 60 * 1000;
    expect(paymentInProgress([pay({ method: "card", createdAt: ago(window - 1) })], now)).toBe(true);
    expect(paymentInProgress([pay({ method: "card", createdAt: ago(window) })], now)).toBe(false);
  });

  it("ignores settled payments and other methods", () => {
    expect(paymentInProgress([pay({ status: "failed" }), pay({ status: "cancelled" })], now)).toBe(false);
    expect(paymentInProgress([pay({ method: "c2b_paybill" }), pay({ method: "manual" })], now)).toBe(false);
    expect(paymentInProgress([], now)).toBe(false);
  });
});

describe("invoiceHasMoney / canHideInvoice", () => {
  it.each(["confirmed", "flagged", "refunded", "credited"] as const)("treats %s as money", (status) => {
    expect(invoiceHasMoney([pay({ status })])).toBe(true);
    expect(canHideInvoice("void", [pay({ status })])).toBe(false);
  });

  it("hides only void invoices without money", () => {
    expect(canHideInvoice("void", [])).toBe(true);
    expect(canHideInvoice("void", [pay({ status: "failed" }), pay({ status: "pending" })])).toBe(true);
    expect(canHideInvoice("open", [])).toBe(false);
    expect(canHideInvoice("paid", [])).toBe(false);
    expect(canHideInvoice("refunded", [])).toBe(false);
  });
});
