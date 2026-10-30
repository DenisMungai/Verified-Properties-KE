import { describe, expect, it, vi } from "vitest";
import { parseServerEnv } from "@/lib/env";
import { paymentView } from "@/lib/billing/payment-view";
import { CARD_REFERENCE_PATTERN, cardReference, cardSettingsFor, isPaystackCheckoutUrl } from "./config";
import { createPaystackGateway, transactionIdFromRaw } from "./paystack";
import { paystackSignature, paystackSignatureValid } from "./signature";

const SECRET = "sk_test_abc123";

describe("paystack signature", () => {
  const body = Buffer.from('{"event":"charge.success","data":{"reference":"VPKC-x"}}');

  it("accepts the HMAC-SHA512 of the exact raw body", () => {
    expect(paystackSignatureValid(body, paystackSignature(body, SECRET), SECRET)).toBe(true);
  });

  it("refuses a changed body, another key, or a missing or malformed header", () => {
    const signature = paystackSignature(body, SECRET);
    expect(paystackSignatureValid(Buffer.from(`${body.toString()} `), signature, SECRET)).toBe(false);
    expect(paystackSignatureValid(body, signature, "sk_test_other")).toBe(false);
    expect(paystackSignatureValid(body, null, SECRET)).toBe(false);
    expect(paystackSignatureValid(body, "not-hex", SECRET)).toBe(false);
    expect(paystackSignatureValid(body, signature.slice(0, 64), SECRET)).toBe(false);
  });
});

describe("card settings", () => {
  const env = (vars: Record<string, string>) => parseServerEnv({ DATABASE_URL: "postgres://unused", ...vars });

  it("is off without a key", () => {
    expect(cardSettingsFor(env({}), "development")).toBeNull();
  });

  it("refuses a test key in production", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(cardSettingsFor(env({ PAYSTACK_SECRET_KEY: SECRET }), "production")).toBeNull();
    expect(error).toHaveBeenCalledWith("[card] test key in production");
    error.mockRestore();
  });

  it("enforces Paystack's IPs with a live key, and the allowlist only when set with a test key", () => {
    expect(cardSettingsFor(env({ PAYSTACK_SECRET_KEY: "sk_live_abc" }), "production")?.allowedIps).toHaveLength(3);
    expect(cardSettingsFor(env({ PAYSTACK_SECRET_KEY: SECRET }), "development")?.allowedIps).toBeNull();
    expect(
      cardSettingsFor(env({ PAYSTACK_SECRET_KEY: SECRET, PAYSTACK_WEBHOOK_ALLOWED_IPS: "10.0.0.0/8" }), "development")?.allowedIps,
    ).toHaveLength(1);
  });

  it("rejects anything that is not a Paystack secret key", () => {
    expect(() => env({ PAYSTACK_SECRET_KEY: "pk_test_public" })).toThrow(/PAYSTACK_SECRET_KEY/);
  });

  it("only accepts Paystack's hosted checkout as a redirect", () => {
    expect(isPaystackCheckoutUrl("https://checkout.paystack.com/abc123")).toBe(true);
    expect(isPaystackCheckoutUrl("https://checkout.paystack.com.evil.example/abc")).toBe(false);
    expect(isPaystackCheckoutUrl("http://checkout.paystack.com/abc")).toBe(false);
    expect(isPaystackCheckoutUrl("javascript:alert(1)")).toBe(false);
  });

  it("builds references Paystack accepts", () => {
    const reference = cardReference("0b9e2c1a-4f5d-4c3b-9a8e-7d6c5b4a3f21");
    expect(reference).toMatch(CARD_REFERENCE_PATTERN);
    expect(reference).toMatch(/^[A-Za-z0-9.=-]+$/);
  });
});

describe("paystack gateway", () => {
  function respond(status: number, body: string) {
    return vi.fn<typeof fetch>(async () => new Response(body, { status, headers: { "content-type": "application/json" } }));
  }

  it("initialises a KES card transaction in cents with our reference and callback", async () => {
    const fetchImpl = respond(
      200,
      JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/x1", access_code: "x1", reference: "VPKC-r" } }),
    );
    const gateway = createPaystackGateway({ secretKey: SECRET, baseUrl: "https://api.test" }, { fetchImpl });
    const result = await gateway.initialize({
      email: "a@b.co",
      amountKes: 2500,
      reference: "VPKC-r",
      callbackUrl: "https://app.test/account/billing/checkout/card-return",
      metadata: { invoice_number: "VPK0000001" },
    });
    expect(result).toEqual({ ok: true, authorizationUrl: "https://checkout.paystack.com/x1", reference: "VPKC-r" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/transaction/initialize");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: "250000",
      currency: "KES",
      reference: "VPKC-r",
      channels: ["card"],
    });
  });

  it("returns a short error without the key when Paystack refuses", async () => {
    const gateway = createPaystackGateway(
      { secretKey: SECRET, baseUrl: "https://api.test" },
      { fetchImpl: respond(401, JSON.stringify({ status: false, message: "Invalid key" })) },
    );
    const result = await gateway.initialize({ email: "a@b.co", amountKes: 1, reference: "r", callbackUrl: "https://x", metadata: {} });
    expect(result).toEqual({ ok: false, error: "HTTP 401 Invalid key" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("verifies a transaction, keeping the 64-bit id exact", async () => {
    const raw =
      '{"status":true,"message":"ok","data":{"id":9007199254740993,"status":"success","reference":"VPKC-r","amount":250000,' +
      '"currency":"KES","paid_at":"2026-11-01T09:00:00.000Z","channel":"card","authorization":{"last4":"4081","brand":"visa"}}}';
    const gateway = createPaystackGateway({ secretKey: SECRET, baseUrl: "https://api.test" }, { fetchImpl: respond(200, raw) });
    expect(await gateway.verify("VPKC-r")).toEqual({
      kind: "result",
      reference: "VPKC-r",
      status: "success",
      amountMinor: 250000,
      currency: "KES",
      paidAt: "2026-11-01T09:00:00.000Z",
      channel: "card",
      transactionId: "9007199254740993",
      brand: "visa",
      last4: "4081",
    });
    expect(transactionIdFromRaw('{"data":{"id":12}}')).toBe("12");
    expect(transactionIdFromRaw('{"data":{"status":"x"}}')).toBeNull();
  });

  it("turns network failures into errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    const gateway = createPaystackGateway({ secretKey: SECRET }, { fetchImpl });
    expect(await gateway.verify("VPKC-r")).toEqual({ kind: "error", error: "timeout" });
  });
});

describe("paymentView", () => {
  const base = {
    method: "card" as const,
    status: "pending" as const,
    resultDesc: null,
    invoiceNumber: "VPK0000001",
    planName: "Pro",
    amountKes: 2,
    periodEnd: null,
  };

  it("reads a declined or abandoned card as failed or cancelled while it stays pending", () => {
    expect(paymentView(base).state).toBe("waiting");
    expect(paymentView({ ...base, resultDesc: "failed" }).state).toBe("failed");
    expect(paymentView({ ...base, resultDesc: "abandoned" }).state).toBe("cancelled");
  });

  it("shows the paid-until date only once confirmed", () => {
    const view = paymentView({ ...base, method: "stk_push", status: "confirmed", periodEnd: new Date("2026-12-01T09:00:00Z") });
    expect(view).toMatchObject({ state: "confirmed", method: "mpesa", paidUntil: "1 Dec 2026" });
  });
});
