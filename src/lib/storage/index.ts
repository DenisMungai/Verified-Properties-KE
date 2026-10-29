import "server-only";
import { getServerEnv, type ServerEnv } from "@/lib/env";
import { createDevDiskStore, DEV_PUBLIC_PATH } from "./dev-disk";
import { StorageNotConfiguredError, type ObjectStore } from "./object-store";
import { createR2Store } from "./r2";

/**
 * Which object storage this deployment uses (prompt S4 decision 2):
 * - `r2` when every R2 variable is set (both buckets and the public base URL)
 * - `dev-disk` outside production when R2 is not fully set
 * - `none` in production without R2: photo actions refuse with a clear message
 */
export type StorageMode = "r2" | "dev-disk" | "none";

export function storageModeFor(env: ServerEnv, nodeEnv = process.env.NODE_ENV): StorageMode {
  const r2Ready = Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_PUBLIC_BUCKET &&
      env.R2_PRIVATE_BUCKET &&
      env.R2_PUBLIC_BASE_URL,
  );
  if (r2Ready) return "r2";
  return nodeEnv === "production" ? "none" : "dev-disk";
}

export function getStorageMode(): StorageMode {
  return storageModeFor(getServerEnv());
}

function devSecret(env: ServerEnv): string {
  if (!env.BETTER_AUTH_SECRET) throw new StorageNotConfiguredError();
  return env.BETTER_AUTH_SECRET;
}

/** The HMAC secret for dev upload tokens, or null when the dev store is not in use. */
export function getDevStorageSecret(): string | null {
  const env = getServerEnv();
  if (storageModeFor(env) !== "dev-disk" || !env.BETTER_AUTH_SECRET) return null;
  return env.BETTER_AUTH_SECRET;
}

function createStore(bucket: "public" | "private"): ObjectStore {
  const env = getServerEnv();
  switch (storageModeFor(env)) {
    case "r2":
      return createR2Store({
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: bucket === "public" ? env.R2_PUBLIC_BUCKET! : env.R2_PRIVATE_BUCKET!,
      });
    case "dev-disk":
      return createDevDiskStore(bucket, devSecret(env));
    case "none":
      throw new StorageNotConfiguredError();
  }
}

let publicStore: ObjectStore | undefined;
let privateStore: ObjectStore | undefined;

/** Processed listing photos, served publicly. */
export function getPublicStore(): ObjectStore {
  return (publicStore ??= createStore("public"));
}

/** Temporary uploads now; verification documents in Phase 2. Never served publicly. */
export function getPrivateStore(): ObjectStore {
  return (privateStore ??= createStore("private"));
}

/**
 * Public URL of a photo without its variant suffix, or null when photos can't be served.
 * `ListingImage` appends `-<width>.webp`.
 */
export function publicImageBaseUrl(baseKey: string | null | undefined): string | null {
  if (!baseKey) return null;
  const env = getServerEnv();
  const path = baseKey.split("/").map(encodeURIComponent).join("/");
  switch (storageModeFor(env)) {
    case "r2":
      return `${env.R2_PUBLIC_BASE_URL!.replace(/\/+$/, "")}/${path}`;
    case "dev-disk":
      return `${DEV_PUBLIC_PATH}/${path}`;
    case "none":
      return null;
  }
}
