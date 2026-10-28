import { inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import { getListerProfile, saveListerProfile } from "@/db/queries/lister-profiles";
import { getUserRoles } from "@/db/queries/roles";
import * as schema from "@/db/schema";
import { grantOperatorRole } from "@/lib/admin-grant";
import { createAuth, type Auth } from "@/lib/auth-config";
import type { EmailMessage } from "@/lib/email/send";
import { listerProfileSchema } from "@/lib/validation/profile";

/**
 * Real Better Auth flows against the Neon test branch (TEST_DATABASE_URL). Users are created with a
 * unique email prefix and deleted afterwards (sessions, accounts, roles and profiles cascade).
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("auth and accounts (integration)", { timeout: 60_000 }, () => {
  const pool = new Pool({ connectionString: url, max: 3 });
  const db = drizzle({ client: pool, schema }) as unknown as DbExecutor;
  const prefix = `it-${Date.now()}-`;
  const outbox: EmailMessage[] = [];
  let auth: Auth;

  const emailFor = (name: string) => `${prefix}${name}@example.test`;
  const lastLinkTo = (to: string) => {
    const message = [...outbox].reverse().find((m) => m.to === to);
    return message ? /https?:\/\/\S+/.exec(message.text)?.[0] : undefined;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  const errorCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return "NO_ERROR";
    } catch (error) {
      return (error as { body?: { code?: string } }).body?.code ?? "UNKNOWN";
    }
  };

  async function signUp(name: string, password = "correct-horse-battery") {
    const email = emailFor(name);
    await auth.api.signUpEmail({ body: { name: `Test ${name}`, email, password } });
    await settle();
    return email;
  }

  async function verify(email: string) {
    const link = lastLinkTo(email);
    if (!link) throw new Error("no verification email captured");
    const token = new URL(link).searchParams.get("token")!;
    await auth.api.verifyEmail({ query: { token } });
  }

  async function userIdFor(email: string) {
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.email, [email]));
    return row.id;
  }

  beforeAll(() => {
    auth = createAuth({
      db,
      secret: "integration-test-secret-integration-test-secret",
      baseURL: "http://localhost:3000",
      production: false,
      sendEmail: async (message) => {
        outbox.push(message);
      },
    });
  });

  afterAll(async () => {
    const ids = (
      await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, `${prefix}%`))
    ).map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(schema.verifications).where(inArray(schema.verifications.value, ids));
      await db.delete(schema.users).where(inArray(schema.users.id, ids));
    }
    await pool.end();
  });

  it("grants only buyer_tenant at sign-up, even when the body forges a role", async () => {
    const email = emailFor("forger");
    const forged = { name: "Forger", email, password: "correct-horse-battery", role: "platform_admin" };
    await errorCode(auth.api.signUpEmail({ body: forged as never }));
    await settle();
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.email, [email]));
    if (row) expect(await getUserRoles(db, row.id)).toEqual(["buyer_tenant"]);
  });

  it("requires email verification before a session exists, then signs in", async () => {
    const email = await signUp("verify");
    expect(lastLinkTo(email)).toContain("/api/auth/verify-email?token=");
    expect(await getUserRoles(db, await userIdFor(email))).toEqual(["buyer_tenant"]);

    const before = await errorCode(auth.api.signInEmail({ body: { email, password: "correct-horse-battery" } }));
    expect(before).toBe("EMAIL_NOT_VERIFIED");

    await verify(email);
    const result = await auth.api.signInEmail({ body: { email, password: "correct-horse-battery" } });
    expect(result.user.email).toBe(email);
  });

  it("does not reveal existing accounts on duplicate sign-up or wrong password", async () => {
    const email = await signUp("dupe");
    expect(await errorCode(auth.api.signUpEmail({ body: { name: "Again", email, password: "another-password-1" } }))).toBe(
      "NO_ERROR",
    );
    await verify(email);
    const wrong = await errorCode(auth.api.signInEmail({ body: { email, password: "wrong-password-1" } }));
    const unknown = await errorCode(
      auth.api.signInEmail({ body: { email: emailFor("nobody"), password: "wrong-password-1" } }),
    );
    expect(wrong).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(unknown).toBe(wrong);
  });

  it("accepts a password-reset token exactly once", async () => {
    const email = await signUp("reset");
    await verify(email);
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    await settle();
    const link = lastLinkTo(email);
    expect(link).toMatch(/\/api\/auth\/reset-password\/[^/?]+\?callbackURL=/);
    const token = new URL(link!).pathname.split("/").pop()!;

    await auth.api.resetPassword({ body: { token, newPassword: "brand-new-password-1" } });
    expect(await errorCode(auth.api.resetPassword({ body: { token, newPassword: "another-new-password-2" } }))).toBe(
      "INVALID_TOKEN",
    );
    const signedIn = await auth.api.signInEmail({ body: { email, password: "brand-new-password-1" } });
    expect(signedIn.user.email).toBe(email);
  });

  it("saves a lister profile and its role together, ignoring forged fields", async () => {
    const email = await signUp("lister");
    const userId = await userIdFor(email);
    const input = listerProfileSchema.parse({
      listerType: "agent",
      displayName: "Amani Homes",
      phone: "0712 345 678",
      publicEmail: "",
      bio: "",
      role: "platform_admin",
    });

    await (db as unknown as { transaction: (fn: (tx: DbExecutor) => Promise<void>) => Promise<void> }).transaction(
      async (tx) => {
        await saveListerProfile(tx, userId, input);
      },
    );
    expect((await getListerProfile(db, userId))?.phone).toBe("+254712345678");
    expect((await getUserRoles(db, userId)).sort()).toEqual(["agent", "buyer_tenant"]);

    await saveListerProfile(db, userId, { ...input, listerType: "developer" });
    expect((await getUserRoles(db, userId)).sort()).toEqual(["buyer_tenant", "owner"]);
  });

  it("grants operator roles only to verified accounts, idempotently", async () => {
    const unverified = await signUp("op-unverified");
    expect((await grantOperatorRole(db, unverified, "platform_admin")).status).toBe("email-not-verified");

    const email = await signUp("op");
    await verify(email);
    expect((await grantOperatorRole(db, email, "agent")).status).toBe("invalid-role");
    expect((await grantOperatorRole(db, emailFor("missing"), "platform_admin")).status).toBe("no-such-user");
    expect((await grantOperatorRole(db, email.toUpperCase(), "platform_admin")).status).toBe("granted");
    expect((await grantOperatorRole(db, email, "platform_admin")).status).toBe("already-had-role");
    expect((await getUserRoles(db, await userIdFor(email))).sort()).toEqual(["buyer_tenant", "platform_admin"]);
  });
});
