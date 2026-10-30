import "server-only";
import { z } from "zod";
import type { C2bRegistration, DarajaClient, StkPushRequest, StkPushResult, StkQueryResult } from "./client";
import { darajaTimestamp, stkPassword } from "./password";
import {
  darajaErrorSchema,
  stkPushResponseSchema,
  stkQueryResultSchema,
  tokenResponseSchema,
} from "./payloads";
import { isQueryStillProcessing } from "./result-codes";

/**
 * Daraja over HTTP (prompt S5 decisions 10 and 13). The OAuth token is cached in module memory
 * until 60 s before it expires; a 401 clears it and retries once. Every call times out after 10 s.
 */

export interface DarajaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
}

const TIMEOUT_MS = 10_000;
const TOKEN_EARLY_EXPIRY_MS = 60_000;

type Fetch = typeof fetch;

class DarajaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Daraja HTTP ${status}`);
    this.name = "DarajaHttpError";
  }
}

/** A short, safe description of a Daraja failure. */
function describe(error: unknown): string {
  if (error instanceof DarajaHttpError) {
    const envelope = darajaErrorSchema.safeParse(error.body);
    return envelope.success
      ? `${error.status} ${envelope.data.errorCode} ${envelope.data.errorMessage}`.slice(0, 200)
      : `HTTP ${error.status}`;
  }
  if (error instanceof Error) return error.name === "TimeoutError" ? "timeout" : error.name;
  return "unknown";
}

export function createDarajaClient(
  config: DarajaConfig,
  { fetchImpl = fetch, now = () => new Date() }: { fetchImpl?: Fetch; now?: () => Date } = {},
): DarajaClient {
  let cached: { token: string; expiresAt: number } | null = null;

  async function getToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
    const res = await fetchImpl(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new DarajaHttpError(res.status, body);
    const parsed = tokenResponseSchema.parse(body);
    cached = {
      token: parsed.access_token,
      expiresAt: Date.now() + parsed.expires_in * 1000 - TOKEN_EARLY_EXPIRY_MS,
    };
    return cached.token;
  }

  async function post<T>(path: string, payload: unknown, schema: z.ZodType<T>, retried = false): Promise<T> {
    const token = await getToken();
    const res = await fetchImpl(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 401 && !retried) {
      cached = null;
      return post(path, payload, schema, true);
    }
    if (!res.ok) throw new DarajaHttpError(res.status, body);
    return schema.parse(body);
  }

  function credentials() {
    const timestamp = darajaTimestamp(now());
    return {
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
    };
  }

  return {
    kind: "daraja",

    async stkPush(request: StkPushRequest): Promise<StkPushResult> {
      try {
        const res = await post(
          "/mpesa/stkpush/v1/processrequest",
          {
            ...credentials(),
            TransactionType: "CustomerPayBillOnline",
            Amount: request.amountKes,
            PartyA: request.phoneDaraja,
            PartyB: config.shortcode,
            PhoneNumber: request.phoneDaraja,
            CallBackURL: request.callbackUrl,
            AccountReference: request.accountReference.slice(0, 12),
            TransactionDesc: request.description.slice(0, 13),
          },
          stkPushResponseSchema,
        );
        if (res.ResponseCode !== "0") return { ok: false, error: `response ${res.ResponseCode}` };
        return {
          ok: true,
          checkoutRequestId: res.CheckoutRequestID,
          merchantRequestId: res.MerchantRequestID,
          customerMessage: res.CustomerMessage,
        };
      } catch (error) {
        return { ok: false, error: describe(error) };
      }
    },

    async stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
      try {
        const res = await post(
          "/mpesa/stkpushquery/v1/query",
          { ...credentials(), CheckoutRequestID: checkoutRequestId },
          stkQueryResultSchema,
        );
        if (isQueryStillProcessing({ resultCode: res.ResultCode })) return { kind: "pending" };
        return { kind: "result", resultCode: res.ResultCode, resultDesc: res.ResultDesc.slice(0, 300) };
      } catch (error) {
        if (error instanceof DarajaHttpError) {
          const envelope = darajaErrorSchema.safeParse(error.body);
          if (envelope.success && isQueryStillProcessing({ errorCode: envelope.data.errorCode })) {
            return { kind: "pending" };
          }
        }
        return { kind: "error", error: describe(error) };
      }
    },

    async registerC2bUrls(registration: C2bRegistration) {
      try {
        await post(
          "/mpesa/c2b/v2/registerurl",
          {
            ShortCode: config.shortcode,
            ResponseType: registration.responseType,
            ConfirmationURL: registration.confirmationUrl,
            ValidationURL: registration.validationUrl,
          },
          z.unknown(),
        );
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: describe(error) };
      }
    },
  };
}
