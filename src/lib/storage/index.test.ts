import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";
import { publicImageBaseUrlFor, storageModeFor } from "./index";

const DB = "postgres://user:pass@host-pooler.neon.tech/db";
const ENDPOINT = "https://br-example.storage.c-7.eu-central-1.aws.neon.tech";
const STORAGE = {
  STORAGE_S3_ENDPOINT: ENDPOINT,
  STORAGE_ACCESS_KEY_ID: "key-id",
  STORAGE_SECRET_ACCESS_KEY: "secret",
  STORAGE_PUBLIC_BUCKET: "listing-photos",
  STORAGE_PRIVATE_BUCKET: "private-uploads",
  STORAGE_PUBLIC_BASE_URL: `${ENDPOINT}/listing-photos/`,
};

describe("storageModeFor", () => {
  it("uses S3 when every storage variable is set, with the region optional", () => {
    const env = parseServerEnv({ DATABASE_URL: DB, ...STORAGE });
    expect(env.STORAGE_S3_REGION).toBe("auto");
    expect(storageModeFor(env, "production")).toBe("s3");
    expect(storageModeFor(env, "development")).toBe("s3");
  });

  it("falls back to the dev disk in development and refuses in production when incomplete", () => {
    const env = parseServerEnv({ DATABASE_URL: DB, ...STORAGE, STORAGE_SECRET_ACCESS_KEY: "" });
    expect(storageModeFor(env, "development")).toBe("dev-disk");
    expect(storageModeFor(env, "production")).toBe("none");
  });
});

describe("publicImageBaseUrlFor", () => {
  it("joins the public base URL and the encoded key without a double slash", () => {
    const env = parseServerEnv({ DATABASE_URL: DB, ...STORAGE });
    expect(publicImageBaseUrlFor(env, "listings/abc/s8w-0", "production")).toBe(
      `${ENDPOINT}/listing-photos/listings/abc/s8w-0`,
    );
  });

  it("serves dev-disk photos through the dev route and nothing without storage", () => {
    const env = parseServerEnv({ DATABASE_URL: DB });
    expect(publicImageBaseUrlFor(env, "listings/abc/s8w-0", "development")).toBe(
      "/api/dev-storage/public/listings/abc/s8w-0",
    );
    expect(publicImageBaseUrlFor(env, "listings/abc/s8w-0", "production")).toBeNull();
    expect(publicImageBaseUrlFor(env, null, "development")).toBeNull();
  });
});
