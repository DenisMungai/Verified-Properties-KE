/**
 * Log-safe forms of provider failures (prompt S21 decision 5). Provider error strings can carry
 * message text; logs keep only the leading code, e.g. "400 400.002.02" from Daraja or "HTTP 401"
 * from Paystack. The full string stays in `payment_events` where the flow already records it.
 */

/** A short code-like token: no spaces, no "@", no long digit runs (phone numbers). */
const CODE_TOKEN = /^[A-Za-z0-9_.-]{1,24}$/;
const LONG_DIGITS = /\d{7,}/;
const MAX_TOKENS = 2;

export function providerCode(error: string | undefined): string {
  const tokens: string[] = [];
  for (const token of (error ?? "").trim().split(/\s+/)) {
    if (tokens.length === MAX_TOKENS || !CODE_TOKEN.test(token) || LONG_DIGITS.test(token)) break;
    tokens.push(token);
  }
  return tokens.length ? tokens.join(" ") : "unknown";
}
