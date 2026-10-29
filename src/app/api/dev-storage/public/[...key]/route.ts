import { getDevStorageSecret, getPublicStore } from "@/lib/storage";
import { isSafeDevKey } from "@/lib/storage/dev-disk";
import { LISTINGS_PREFIX } from "@/lib/storage/keys";

const MAX_SERVED_BYTES = 10 * 1024 * 1024;

/**
 * Development stand-in for the public R2 bucket: serves processed listing photos only. Private
 * uploads are never reachable here. 404 in production and whenever R2 is set up.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }): Promise<Response> {
  if (!getDevStorageSecret()) return new Response(null, { status: 404 });
  const key = (await params).key.join("/");
  if (!key.startsWith(LISTINGS_PREFIX) || !key.endsWith(".webp") || !isSafeDevKey(key)) {
    return new Response(null, { status: 404 });
  }
  const body = await getPublicStore().get(key, MAX_SERVED_BYTES);
  if (!body) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
