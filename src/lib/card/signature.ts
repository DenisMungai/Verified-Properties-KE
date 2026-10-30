import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack webhook signatures (prompt S6 decision 16): `x-paystack-signature` is the hex
 * HMAC-SHA512 of the raw body, keyed with the secret key. Checked before anything is parsed or
 * recorded.
 */
export function paystackSignature(rawBody: Buffer | string, secretKey: string): string {
  return createHmac("sha512", secretKey).update(rawBody).digest("hex");
}

export function paystackSignatureValid(rawBody: Buffer | string, signature: string | null, secretKey: string): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = Buffer.from(paystackSignature(rawBody, secretKey), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
