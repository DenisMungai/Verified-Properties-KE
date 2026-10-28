/** Where signed-in users land when there is no (valid) destination. */
export const DEFAULT_SIGNED_IN_PATH = "/account";

/**
 * Only same-origin relative paths may be used as a post-sign-in destination.
 * Blocks open redirects such as "//evil.com", "/\evil.com", "https://evil.com" and encoded or
 * control-character variants of them.
 */
export function safeNextPath(value: unknown, fallback = DEFAULT_SIGNED_IN_PATH): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > 512) return fallback;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }

  for (const candidate of [value, decoded]) {
    if (!candidate.startsWith("/")) return fallback;
    if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
    if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return fallback;
  }

  // Final guard: resolving against a dummy origin must not change the origin.
  try {
    const resolved = new URL(value, "https://vpk.invalid");
    if (resolved.origin !== "https://vpk.invalid") return fallback;
  } catch {
    return fallback;
  }
  return value;
}

/** "/sign-in?next=%2Faccount%2Fsettings" for a protected destination. */
export function signInPath(next: string): string {
  const safe = safeNextPath(next);
  return safe === DEFAULT_SIGNED_IN_PATH ? "/sign-in" : `/sign-in?next=${encodeURIComponent(safe)}`;
}
