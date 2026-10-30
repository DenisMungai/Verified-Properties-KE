import { describe, expect, it, vi } from "vitest";
import { createDarajaClient } from "./daraja";

const config = {
  baseUrl: "https://sandbox.example",
  consumerKey: "key",
  consumerSecret: "secret",
  shortcode: "174379",
  passkey: "passkey",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const tokenResponse = () => json(200, { access_token: "tok", expires_in: "3599" });

const pushRequest = {
  phoneDaraja: "254712345678",
  amountKes: 1,
  accountReference: "VPK0000012",
  description: "Starter plan for agents",
  callbackUrl: "https://app.example/api/payments/stk/secret",
};

function fetchSequence(...responses: Response[]) {
  const fn = vi.fn<typeof fetch>();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  return fn;
}

describe("Daraja HTTP client", () => {
  it("sends a Paybill STK Push with the computed password and trimmed fields", async () => {
    const fetchImpl = fetchSequence(
      tokenResponse(),
      json(200, { MerchantRequestID: "m1", CheckoutRequestID: "ws_CO_1", ResponseCode: "0", CustomerMessage: "ok" }),
    );
    const client = createDarajaClient(config, { fetchImpl, now: () => new Date("2026-10-29T09:00:00Z") });

    const result = await client.stkPush(pushRequest);
    expect(result).toEqual({ ok: true, checkoutRequestId: "ws_CO_1", merchantRequestId: "m1", customerMessage: "ok" });

    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("https://sandbox.example/mpesa/stkpush/v1/processrequest");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      BusinessShortCode: "174379",
      Timestamp: "20261029120000",
      TransactionType: "CustomerPayBillOnline",
      PartyA: "254712345678",
      PartyB: "174379",
      AccountReference: "VPK0000012",
      TransactionDesc: "Starter plan ",
    });
    expect(Buffer.from(body.Password, "base64").toString()).toBe("174379passkey20261029120000");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("caches the token across calls and refreshes once after a 401", async () => {
    const fetchImpl = fetchSequence(
      tokenResponse(),
      json(200, { ResultCode: "0", ResultDesc: "ok" }),
      json(200, { ResultCode: "1032", ResultDesc: "cancelled" }),
      json(401, { errorCode: "404.001.03", errorMessage: "Invalid Access Token" }),
      tokenResponse(),
      json(200, { ResultCode: "0", ResultDesc: "ok" }),
    );
    const client = createDarajaClient(config, { fetchImpl });

    expect(await client.stkQuery("ws_CO_1")).toEqual({ kind: "result", resultCode: 0, resultDesc: "ok" });
    expect(await client.stkQuery("ws_CO_1")).toEqual({ kind: "result", resultCode: 1032, resultDesc: "cancelled" });
    expect(await client.stkQuery("ws_CO_1")).toEqual({ kind: "result", resultCode: 0, resultDesc: "ok" });
    const tokenCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes("/oauth/"));
    expect(tokenCalls).toHaveLength(2);
  });

  it("reports a still-processing query as pending", async () => {
    const fetchImpl = fetchSequence(
      tokenResponse(),
      json(500, { requestId: "r", errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }),
    );
    expect(await createDarajaClient(config, { fetchImpl }).stkQuery("ws_CO_1")).toEqual({ kind: "pending" });
  });

  it("returns short errors without secrets when Daraja refuses", async () => {
    const fetchImpl = fetchSequence(
      tokenResponse(),
      json(400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" }),
    );
    const result = await createDarajaClient(config, { fetchImpl }).stkPush(pushRequest);
    expect(result).toEqual({ ok: false, error: "400 400.002.02 Bad Request - Invalid PhoneNumber" });
  });

  it("treats a non-zero ResponseCode as a refusal", async () => {
    const fetchImpl = fetchSequence(
      tokenResponse(),
      json(200, { MerchantRequestID: "m", CheckoutRequestID: "c", ResponseCode: "1", CustomerMessage: "" }),
    );
    expect(await createDarajaClient(config, { fetchImpl }).stkPush(pushRequest)).toEqual({ ok: false, error: "response 1" });
  });

  it("turns network failures into errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }));
    const client = createDarajaClient(config, { fetchImpl });
    expect(await client.stkPush(pushRequest)).toEqual({ ok: false, error: "timeout" });
    expect(await client.stkQuery("ws_CO_1")).toEqual({ kind: "error", error: "timeout" });
  });
});
