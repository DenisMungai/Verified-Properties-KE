import { Receiver } from "@upstash/qstash";

/**
 * QStash request signatures (prompt S9 decision 2). The JWT in `Upstash-Signature` is checked
 * against the current key, then the next one (key rotation), along with its issuer, expiry and
 * the SHA-256 of the raw body. The URL claim is not pinned (preview domains differ); every job is
 * idempotent and takes no input. There is no unsigned bypass in any environment.
 */

export interface SigningKeys {
  current: string;
  next: string;
}

export type SignatureCheck = "ok" | "invalid" | "not_configured";

export function signingKeysFrom(env: { QSTASH_CURRENT_SIGNING_KEY?: string; QSTASH_NEXT_SIGNING_KEY?: string }): SigningKeys | null {
  const current = env.QSTASH_CURRENT_SIGNING_KEY;
  const next = env.QSTASH_NEXT_SIGNING_KEY;
  return current && next ? { current, next } : null;
}

export async function verifyQstashSignature(
  keys: SigningKeys | null,
  signature: string | null,
  body: string,
): Promise<SignatureCheck> {
  if (!keys) return "not_configured";
  if (!signature) return "invalid";
  // devMode false: never fall back to the QStash dev server's well-known keys.
  const receiver = new Receiver({ currentSigningKey: keys.current, nextSigningKey: keys.next, devMode: false });
  try {
    return (await receiver.verify({ signature, body, clockTolerance: 5 })) ? "ok" : "invalid";
  } catch {
    return "invalid";
  }
}
