import { getDevStorageSecret, getPrivateStore } from "@/lib/storage";
import { verifyUploadToken } from "@/lib/storage/dev-disk";
import { UPLOADS_PREFIX } from "@/lib/storage/keys";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/limits";
import { readCapped, TooLargeError } from "@/lib/storage/object-store";

/**
 * Development stand-in for an R2 presigned PUT (prompt S4 decision 2). Accepts exactly the key,
 * content type and length signed into the token. 404 in production and whenever R2 is set up.
 */
export async function PUT(request: Request): Promise<Response> {
  const secret = getDevStorageSecret();
  if (!secret) return new Response(null, { status: 404 });

  const grant = verifyUploadToken(new URL(request.url).searchParams.get("t") ?? "", secret);
  if (!grant || !grant.key.startsWith(UPLOADS_PREFIX)) return new Response("Upload link is invalid or expired.", { status: 403 });
  if (request.headers.get("content-type") !== grant.contentType) {
    return new Response("Content type does not match.", { status: 403 });
  }
  if (Number(request.headers.get("content-length")) !== grant.contentLength || !request.body) {
    return new Response("Content length does not match.", { status: 403 });
  }

  let body: Buffer;
  try {
    // Node's web ReadableStream is async-iterable; the DOM lib types don't say so.
    const stream = request.body as unknown as AsyncIterable<Uint8Array>;
    body = await readCapped(stream, Math.min(grant.contentLength, MAX_UPLOAD_BYTES));
  } catch (error) {
    if (error instanceof TooLargeError) return new Response("Too large.", { status: 413 });
    throw error;
  }
  if (body.length !== grant.contentLength) return new Response("Content length does not match.", { status: 400 });

  await getPrivateStore().put(grant.key, body, grant.contentType);
  return new Response(null, { status: 200 });
}
