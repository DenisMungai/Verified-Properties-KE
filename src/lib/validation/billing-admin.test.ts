import { describe, expect, it } from "vitest";
import { activateSchema, classifyBillingSearch, recordPaybillSchema, refundSchema } from "./billing-admin";

describe("classifyBillingSearch", () => {
  it("ignores blank searches", () => {
    expect(classifyBillingSearch(undefined)).toBeNull();
    expect(classifyBillingSearch("   ")).toBeNull();
  });

  it("recognises invoice numbers in any case", () => {
    expect(classifyBillingSearch(" vpk0000123 ")).toEqual({ kind: "invoice", invoiceNumber: "VPK0000123" });
  });

  it("treats Kenyan numbers as phones before receipts", () => {
    expect(classifyBillingSearch("0712345678")).toEqual({ kind: "phone", e164: "+254712345678" });
    expect(classifyBillingSearch("+254 712 345 678")).toEqual({ kind: "phone", e164: "+254712345678" });
  });

  it("recognises M-Pesa receipts", () => {
    expect(classifyBillingSearch("sgr7abc123")).toEqual({ kind: "receipt", receipt: "SGR7ABC123" });
  });

  it("falls back to a card reference, case kept", () => {
    expect(classifyBillingSearch("vpk-card-AbC123")).toEqual({ kind: "reference", reference: "vpk-card-AbC123" });
  });

  it("caps the search length", () => {
    expect(classifyBillingSearch("x".repeat(100))).toEqual({ kind: "reference", reference: "x".repeat(40) });
  });
});

const reason = "Checked against the M-Pesa statement.";
const paymentId = "6f1c1b7e-8d0e-4d3a-9a3b-2a1f0e6c5d4b";

describe("billing admin schemas", () => {
  it("lets Activate fall back to the stored callback values", () => {
    const parsed = activateSchema.parse({ paymentId, receipt: "", amountKes: "", reason });
    expect(parsed.receipt).toBe("");
    expect(parsed.amountKes).toBe("");
  });

  it("normalises typed receipts and amounts", () => {
    const parsed = activateSchema.parse({ paymentId, receipt: " sgr7abc123", amountKes: "1500", reason });
    expect(parsed.receipt).toBe("SGR7ABC123");
    expect(parsed.amountKes).toBe(1500);
  });

  it("requires a real reason", () => {
    expect(refundSchema.safeParse({ reference: "REF123", amountKes: "10", reason: "short" }).success).toBe(false);
  });

  it("rejects fractional amounts and receipts without a letter", () => {
    expect(refundSchema.safeParse({ reference: "REF123", amountKes: "10.5", reason }).success).toBe(false);
    expect(recordPaybillSchema.safeParse({ invoiceNumber: "VPK0000123", receipt: "1234567890", amountKes: "10", phone: "", reason }).success).toBe(false);
  });

  it("normalises the optional phone on recorded Paybill payments", () => {
    const parsed = recordPaybillSchema.parse({ invoiceNumber: "vpk0000123", receipt: "SGR7ABC123", amountKes: "10", phone: "0712 345 678", reason });
    expect(parsed).toMatchObject({ invoiceNumber: "VPK0000123", phone: "+254712345678", amountKes: 10 });
    expect(recordPaybillSchema.parse({ invoiceNumber: "VPK0000123", receipt: "SGR7ABC123", amountKes: "10", phone: "", reason }).phone).toBeNull();
  });
});
