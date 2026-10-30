import { ipAllowed, requestIp, tokenMatches } from "./callback-guard";
import type { MpesaSettings } from "./config";

/**
 * The checks every payment callback route runs before touching its body (prompt S5 decisions 3
 * and 4). Pure apart from reading the request, so the 404/403/413 rules are unit-tested.
 */

/** Daraja callbacks are a few KB; anything bigger is not from Safaricom. */
export const MAX_CALLBACK_BYTES = 32 * 1024;

export type GuardResult =
  | { ok: true; ip: string | null }
  | { ok: false; status: 404 }
  | { ok: false; status: 403; ip: string | null };

/**
 * 404 when M-Pesa is off or the token is wrong (the route's existence is not revealed), 403 when
 * the allowlist is enforced and the caller is outside it.
 */
export function guardCallback(settings: MpesaSettings | null, token: string, headers: Headers): GuardResult {
  if (!settings || !tokenMatches(token, settings.callbackToken)) return { ok: false, status: 404 };
  const ip = requestIp(headers);
  if (settings.allowedIps && !ipAllowed(ip, settings.allowedIps)) return { ok: false, status: 403, ip };
  return { ok: true, ip };
}

export type BodyResult = { ok: true; json: unknown } | { ok: false; status: 400 | 413 };
export type RawBodyResult = { ok: true; raw: Buffer } | { ok: false; status: 400 | 413 };

/** Reads at most `maxBytes` of the body as bytes (signed webhooks need the exact bytes). */
export async function readRawBody(request: Request, maxBytes = MAX_CALLBACK_BYTES): Promise<RawBodyResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  return { ok: true, raw: Buffer.concat(chunks) };
}

/** Reads at most `maxBytes` of the body and parses it as JSON. */
export async function readJsonBody(request: Request, maxBytes = MAX_CALLBACK_BYTES): Promise<BodyResult> {
  const body = await readRawBody(request, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, json: JSON.parse(body.raw.toString("utf8")) };
  } catch {
    return { ok: false, status: 400 };
  }
}
