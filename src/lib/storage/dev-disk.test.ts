import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevDiskStore, createUploadToken, devObjectPath, isSafeDevKey, verifyUploadToken } from "./dev-disk";
import { TooLargeError } from "./object-store";

const secret = "a".repeat(40);
const grant = { key: "uploads/u_owner/abc", contentType: "image/jpeg", contentLength: 1234, expiresAt: 2_000 };

describe("dev upload tokens", () => {
  it("round-trip before expiry", () => {
    expect(verifyUploadToken(createUploadToken(grant, secret), secret, 1_000)).toEqual(grant);
  });

  it("are refused when expired, tampered with or signed with another secret", () => {
    const token = createUploadToken(grant, secret);
    expect(verifyUploadToken(token, secret, 2_001)).toBeNull();
    expect(verifyUploadToken(token, "b".repeat(40), 1_000)).toBeNull();

    const forged = Buffer.from(JSON.stringify({ ...grant, contentLength: 9_999_999 })).toString("base64url");
    expect(verifyUploadToken(`${forged}.${token.split(".")[1]}`, secret, 1_000)).toBeNull();
    expect(verifyUploadToken("garbage", secret, 1_000)).toBeNull();
    expect(verifyUploadToken(`${token}.extra`, secret, 1_000)).toBeNull();
  });

  it("are refused for unsafe keys even when correctly signed", () => {
    const token = createUploadToken({ ...grant, key: "uploads/../../etc/passwd" }, secret);
    expect(verifyUploadToken(token, secret, 1_000)).toBeNull();
  });
});

describe("dev disk keys", () => {
  it("reject traversal and odd characters", () => {
    for (const key of ["../x", "uploads/../x", "/abs", "a//b", "a/b.png", "a\\b", "a/./b", ""]) {
      expect(isSafeDevKey(key), key).toBe(false);
    }
    expect(isSafeDevKey("listings/abc/def-480.webp")).toBe(true);
    expect(() => devObjectPath("/root", "public", "../private/x")).toThrow();
  });
});

describe("dev disk store", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vpk-dev-store-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores, lists, caps and deletes objects inside its bucket folder", async () => {
    const store = createDevDiskStore("public", secret, root);
    await store.put("listings/a/b-480.webp", Buffer.from("hello"), "image/webp");
    expect((await store.get("listings/a/b-480.webp", 100))?.toString()).toBe("hello");
    await expect(store.get("listings/a/b-480.webp", 2)).rejects.toBeInstanceOf(TooLargeError);
    expect((await store.list("listings/")).map((o) => o.key)).toEqual(["listings/a/b-480.webp"]);
    expect(await createDevDiskStore("private", secret, root).list("")).toEqual([]);

    await store.delete(["listings/a/b-480.webp"]);
    expect(await store.get("listings/a/b-480.webp", 100)).toBeNull();
  });

  it("signs uploads to the private bucket only", async () => {
    const url = await createDevDiskStore("private", secret, root).presignPut("uploads/u/x", "image/png", 10, 300);
    const token = decodeURIComponent(new URL(url, "http://localhost").searchParams.get("t") ?? "");
    expect(verifyUploadToken(token, secret)).toMatchObject({ key: "uploads/u/x", contentType: "image/png", contentLength: 10 });
    await expect(createDevDiskStore("public", secret, root).presignPut("uploads/u/x", "image/png", 10, 300)).rejects.toThrow();
  });
});
