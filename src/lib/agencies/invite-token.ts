import { createHash, randomBytes } from "node:crypto";

/**
 * Agency invite tokens (prompt S23 decision 4 and requirement 4). 32 random bytes, base64url, in
 * the email link only; the database keeps the SHA-256 hex, and lookups go by that hash.
 */

export const INVITE_TTL_DAYS = 7;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before any database lookup. */
export function isWellFormedInviteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

export function invitePath(token: string): string {
  return `/account/agency/invites/${token}`;
}
