import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TooLargeError, type ObjectStore, type StoredObject } from "./object-store";

/**
 * Development-only object store on the local disk (prompt S4 decision 2), used when R2 is not
 * configured. Its "presigned URL" is a dev route carrying an HMAC token, so the browser code is
 * the same as with R2. It is never selected in production.
 */

export type DevBucket = "public" | "private";

export const DEV_STORAGE_ROOT = path.join(process.cwd(), ".data", "storage");
export const DEV_UPLOAD_PATH = "/api/dev-storage/upload";
export const DEV_PUBLIC_PATH = "/api/dev-storage/public";

/** Letters, digits, `/`, `_` and `-`, with an optional `.webp` suffix: no dots, so no `..`. */
const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.webp)?$/;

export function isSafeDevKey(key: string): boolean {
  return key.length <= 300 && KEY_PATTERN.test(key);
}

/** Absolute path of a key inside a bucket folder; throws for anything that could escape it. */
export function devObjectPath(root: string, bucket: DevBucket, key: string): string {
  if (!isSafeDevKey(key)) throw new Error("Unsafe storage key");
  const bucketRoot = path.resolve(root, bucket);
  const full = path.resolve(bucketRoot, ...key.split("/"));
  if (!full.startsWith(bucketRoot + path.sep)) throw new Error("Unsafe storage key");
  return full;
}

/* ------------------------------- upload tokens ------------------------------- */

export interface UploadGrant {
  key: string;
  contentType: string;
  contentLength: number;
  expiresAt: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createUploadToken(grant: UploadGrant, secret: string): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The grant behind a token, or null if it is malformed, tampered with or expired. */
export function verifyUploadToken(token: string, secret: string, now = Date.now()): UploadGrant | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let grant: UploadGrant;
  try {
    grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadGrant;
  } catch {
    return null;
  }
  if (
    typeof grant.key !== "string" ||
    typeof grant.contentType !== "string" ||
    !Number.isInteger(grant.contentLength) ||
    typeof grant.expiresAt !== "number" ||
    grant.expiresAt < now ||
    !isSafeDevKey(grant.key)
  ) {
    return null;
  }
  return grant;
}

/* ---------------------------------- store ---------------------------------- */

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export function createDevDiskStore(bucket: DevBucket, secret: string, root = DEV_STORAGE_ROOT): ObjectStore {
  const bucketRoot = path.resolve(root, bucket);
  return {
    async presignPut(key, contentType, contentLength, expiresIn) {
      if (bucket !== "private") throw new Error("Dev uploads go to the private bucket only");
      const token = createUploadToken(
        { key, contentType, contentLength, expiresAt: Date.now() + expiresIn * 1000 },
        secret,
      );
      return `${DEV_UPLOAD_PATH}?t=${encodeURIComponent(token)}`;
    },

    async get(key, maxBytes) {
      const file = devObjectPath(root, bucket, key);
      let info;
      try {
        info = await stat(file);
      } catch {
        return null;
      }
      if (info.size > maxBytes) throw new TooLargeError();
      return readFile(file);
    },

    async put(key, body) {
      const file = devObjectPath(root, bucket, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },

    async delete(keys) {
      for (const key of keys) await rm(devObjectPath(root, bucket, key), { force: true });
    },

    async list(prefix) {
      const objects: StoredObject[] = [];
      for (const file of await walk(bucketRoot)) {
        const key = path.relative(bucketRoot, file).split(path.sep).join("/");
        if (!key.startsWith(prefix)) continue;
        objects.push({ key, lastModified: (await stat(file)).mtime });
      }
      return objects;
    },
  };
}
