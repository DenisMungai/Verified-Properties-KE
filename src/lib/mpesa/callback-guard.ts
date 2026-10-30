import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Callback protection (prompt S5 decisions 3 and 4). Daraja callbacks are unsigned, so a route
 * accepts a request only with the secret path token and, where enforced, from an allowed IP.
 * Neither is enough alone: the Query API and exact invoice matching still decide.
 */

/** Community-documented Safaricom callback ranges; not an official list. Confirm at go-live. */
export const DEFAULT_SAFARICOM_RANGES = "196.201.212.0/24,196.201.213.0/24,196.201.214.0/24";

export interface Cidr {
  base: number;
  mask: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison; hashing first makes the lengths equal. */
export function tokenMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function ipv4ToInt(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const n = Number(octet);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** Plain IPv4, or the IPv4 inside an IPv4-mapped IPv6 address (::ffff:1.2.3.4). */
export function normalizeIp(ip: string): string | null {
  const trimmed = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(trimmed);
  const candidate = mapped ? mapped[1] : trimmed;
  return ipv4ToInt(candidate) === null ? null : candidate;
}

/** "a/b, c/d" -> CIDRs. A bare address means /32. Throws on anything malformed, naming `source`. */
export function parseCidrs(list: string, source = "MPESA_CALLBACK_ALLOWED_IPS"): Cidr[] {
  return list
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [ip, bitsText = "32"] = entry.split("/");
      const base = ipv4ToInt(ip);
      const bits = Number(bitsText);
      if (base === null || !/^\d{1,2}$/.test(bitsText) || bits > 32) {
        throw new Error(`Invalid CIDR in ${source}: ${entry}`);
      }
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return { base: (base & mask) >>> 0, mask };
    });
}

export function ipAllowed(ip: string | null, cidrs: readonly Cidr[]): boolean {
  const normalized = ip ? normalizeIp(ip) : null;
  if (!normalized) return false;
  const value = ipv4ToInt(normalized)!;
  return cidrs.some(({ base, mask }) => ((value & mask) >>> 0) === base);
}

/** Vercel sets both headers and overwrites client-sent values; x-real-ip is the single client IP. */
export function requestIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
