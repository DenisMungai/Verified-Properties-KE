import { describe, expect, it } from "vitest";
import { parseC2b, parseStkCallback, wholeKes } from "./payloads";

const success = {
  Body: {
    stkCallback: {
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_191220191020363925",
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: 1.0 },
          { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
          { Name: "Balance" },
          { Name: "TransactionDate", Value: 20191219102115 },
          { Name: "PhoneNumber", Value: 254708374149 },
        ],
      },
    },
  },
};

describe("parseStkCallback", () => {
  it("extracts the result and metadata from a success callback", () => {
    expect(parseStkCallback(success)).toEqual({
      checkoutRequestId: "ws_CO_191220191020363925",
      merchantRequestId: "29115-34620561-1",
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
      receipt: "NLJ7RT61SV",
      amount: 1,
      phone: "254708374149",
    });
  });

  it("handles a cancelled callback without metadata, and string result codes", () => {
    const parsed = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: "m",
          CheckoutRequestID: "ws_CO_1",
          ResultCode: "1032",
          ResultDesc: "Request cancelled by user",
        },
      },
    });
    expect(parsed).toMatchObject({ resultCode: 1032, receipt: null, amount: null, phone: null });
  });

  it("drops a malformed receipt and keeps a fractional amount for flagging", () => {
    const body = structuredClone(success);
    body.Body.stkCallback.CallbackMetadata.Item[0].Value = 1.5;
    body.Body.stkCallback.CallbackMetadata.Item[1].Value = "bad receipt!";
    expect(parseStkCallback(body)).toMatchObject({ receipt: null, amount: 1.5 });
  });

  it("returns null for anything that is not a callback", () => {
    expect(parseStkCallback(null)).toBeNull();
    expect(parseStkCallback({ Body: {} })).toBeNull();
    expect(parseStkCallback({ Body: { stkCallback: { ResultCode: 0 } } })).toBeNull();
  });
});

describe("parseC2b", () => {
  const body = {
    TransactionType: "Pay Bill",
    TransID: "RKTQDM7W6S",
    TransTime: "20191122063845",
    TransAmount: "10.00",
    BusinessShortCode: "600638",
    BillRefNumber: " vpk0000012 ",
    MSISDN: "25470****149",
    FirstName: "John",
  };

  it("normalises the account number and parses the amount", () => {
    expect(parseC2b(body)).toEqual({
      transId: "RKTQDM7W6S",
      amount: 10,
      shortcode: "600638",
      billRef: "VPK0000012",
      msisdn: "25470****149",
    });
  });

  it("rejects bodies without a valid transaction id or amount", () => {
    expect(parseC2b({ ...body, TransID: "x" })).toBeNull();
    expect(parseC2b({ ...body, TransAmount: "ten" })).toBeNull();
  });
});

describe("wholeKes", () => {
  it("keeps whole non-negative shillings only", () => {
    expect(wholeKes(10)).toBe(10);
    expect(wholeKes(10.5)).toBeNull();
    expect(wholeKes(-1)).toBeNull();
    expect(wholeKes(null)).toBeNull();
  });
});
