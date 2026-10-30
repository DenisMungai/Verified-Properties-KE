import "server-only";
import { z } from "zod";
import { PAYSTACK_BASE_URL } from "./config";
import type { CardGateway, CardInitRequest, CardInitResult, CardVerifyResult } from "./gateway";

/**
 * Paystack over HTTP (prompt S6 decisions 14 and 16): Initialize Transaction and Verify
 * Transaction with the secret key, 10 s timeouts, Zod-parsed responses. Errors carry a status and
 * Paystack's short message only, never the key, the email or the request body.
 */

const TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

const envelopeSchema = z.object({ status: z.boolean(), message: z.string().optional() });

const initSchema = envelopeSchema.extend({
  data: z.object({ authorization_url: z.url(), reference: z.string() }),
});

const verifySchema = envelopeSchema.extend({
  data: z.object({
    reference: z.string(),
    status: z.string(),
    amount: z.coerce.number().int().nonnegative(),
    currency: z.string(),
    paid_at: z.string().nullish(),
    channel: z.string().nullish(),
    authorization: z
      .object({ brand: z.string().nullish(), last4: z.string().nullish(), card_type: z.string().nullish() })
      .nullish(),
  }),
});

/**
 * The transaction id is a 64-bit integer: JSON.parse would round it. It is the first key of
 * `data`, so it is read from the raw text as digits.
 */
export function transactionIdFromRaw(raw: string): string | null {
  return /"data"\s*:\s*\{\s*"id"\s*:\s*(\d+)/.exec(raw)?.[1] ?? null;
}

function describe(status: number, body: unknown): string {
  const envelope = envelopeSchema.safeParse(body);
  const message = envelope.success && envelope.data.message ? ` ${envelope.data.message}` : "";
  return `HTTP ${status}${message}`.slice(0, 200);
}

function failure(error: unknown): string {
  if (error instanceof Error) return error.name === "TimeoutError" ? "timeout" : error.name;
  return "unknown";
}

export function createPaystackGateway(
  { secretKey, baseUrl = PAYSTACK_BASE_URL }: { secretKey: string; baseUrl?: string },
  { fetchImpl = fetch }: { fetchImpl?: Fetch } = {},
): CardGateway {
  const headers = { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" };

  return {
    kind: "paystack",

    async initialize(request: CardInitRequest): Promise<CardInitResult> {
      try {
        const res = await fetchImpl(`${baseUrl}/transaction/initialize`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            email: request.email,
            amount: String(request.amountKes * 100),
            currency: "KES",
            reference: request.reference,
            callback_url: request.callbackUrl,
            channels: ["card"],
            metadata: JSON.stringify(request.metadata),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, error: describe(res.status, body) };
        const parsed = initSchema.safeParse(body);
        if (!parsed.success || !parsed.data.status) return { ok: false, error: "unexpected response" };
        return { ok: true, authorizationUrl: parsed.data.data.authorization_url, reference: parsed.data.data.reference };
      } catch (error) {
        return { ok: false, error: failure(error) };
      }
    },

    async verify(reference: string): Promise<CardVerifyResult> {
      try {
        const res = await fetchImpl(`${baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
          headers: { Authorization: headers.Authorization },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const raw = await res.text();
        let body: unknown = null;
        try {
          body = JSON.parse(raw);
        } catch {
          // reported below
        }
        if (!res.ok) return { kind: "error", error: describe(res.status, body) };
        const parsed = verifySchema.safeParse(body);
        if (!parsed.success || !parsed.data.status) return { kind: "error", error: "unexpected response" };
        const data = parsed.data.data;
        return {
          kind: "result",
          reference: data.reference,
          status: data.status,
          amountMinor: data.amount,
          currency: data.currency.toUpperCase(),
          paidAt: data.paid_at ?? null,
          channel: data.channel ?? null,
          transactionId: transactionIdFromRaw(raw),
          brand: data.authorization?.brand?.trim() || null,
          last4: data.authorization?.last4 && /^\d{4}$/.test(data.authorization.last4) ? data.authorization.last4 : null,
        };
      } catch (error) {
        return { kind: "error", error: failure(error) };
      }
    },
  };
}
