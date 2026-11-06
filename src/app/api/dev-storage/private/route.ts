import { connection } from "next/server";
import { getDevStorageSecret, getPrivateStore } from "@/lib/storage";
import { verifyReadToken } from "@/lib/storage/dev-disk";
import { VERIFICATION_PREFIX } from "@/lib/storage/keys";
import { sniffDocumentType } from "@/lib/verification/sniff";
import { MAX_DOCUMENT_BYTES } from "@/lib/verification/rules";

/**
 * Development stand-in for a presigned GET on the private bucket (prompt S12 decision 7): serves
 * one verification document for a signed, short-lived token. 404 in production and whenever real
 * storage is set up.
 */
export async function GET(request: Request): Promise<Response> {
  // Per request, never prerendered: every link is signed and expires.
  await connection();
  const secret = getDevStorageSecret();
  if (!secret) return new Response(null, { status: 404 });
  const key = verifyReadToken(new URL(request.url).searchParams.get("t") ?? "", secret);
  if (!key || !key.startsWith(VERIFICATION_PREFIX)) return new Response("Link is invalid or expired.", { status: 403 });
  const body = await getPrivateStore().get(key, MAX_DOCUMENT_BYTES);
  const type = body ? sniffDocumentType(body) : null;
  if (!body || !type) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
