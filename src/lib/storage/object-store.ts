/**
 * The object storage the app needs. R2 implements it in production, a local-disk store in
 * development without R2, and an in-memory store in tests.
 */
export interface StoredObject {
  key: string;
  lastModified: Date;
}

export interface ObjectStore {
  /** A URL the browser can PUT one object to. Key, content type and length are all fixed. */
  presignPut(key: string, contentType: string, contentLength: number, expiresInSeconds: number): Promise<string>;
  /** Null when the object is missing; throws TooLargeError once it passes `maxBytes`. */
  get(key: string, maxBytes: number): Promise<Buffer | null>;
  put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
}

/** Public listing images never change under a key, so they can be cached for a year. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export class TooLargeError extends Error {
  constructor() {
    super("Object is larger than allowed");
    this.name = "TooLargeError";
  }
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Photo storage is not configured");
    this.name = "StorageNotConfiguredError";
  }
}

/** Collects a streamed body, stopping as soon as it passes `maxBytes`. */
export async function readCapped(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) throw new TooLargeError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
