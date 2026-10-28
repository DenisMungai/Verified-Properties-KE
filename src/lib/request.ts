import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP behind Vercel or a proxy. Used only as a (hashed) rate-limit key. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
