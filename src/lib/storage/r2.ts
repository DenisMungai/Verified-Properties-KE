import "server-only";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readCapped, TooLargeError, type ObjectStore, type StoredObject } from "./object-store";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const DELETE_BATCH = 1000;

/** Cloudflare R2 through its S3-compatible API. Server-only: it holds secret credentials. */
export function createR2Store(config: R2Config): ObjectStore {
  const { bucket } = config;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  return {
    presignPut: (key, contentType, contentLength, expiresIn) =>
      getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
        // Sign the type and length too, so the browser must send exactly what was approved.
        { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
      ),

    async get(key, maxBytes) {
      let res;
      try {
        res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if ((error as { name?: string }).name === "NoSuchKey") return null;
        throw error;
      }
      if ((res.ContentLength ?? 0) > maxBytes) throw new TooLargeError();
      return readCapped(res.Body as AsyncIterable<Uint8Array>, maxBytes);
    },

    async put(key, body, contentType, cacheControl) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }),
      );
    },

    async delete(keys) {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const batch = keys.slice(i, i + DELETE_BATCH);
        await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
        );
      }
    },

    async list(prefix) {
      const objects: StoredObject[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const item of res.Contents ?? []) {
          if (item.Key) objects.push({ key: item.Key, lastModified: item.LastModified ?? new Date(0) });
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },
  };
}
