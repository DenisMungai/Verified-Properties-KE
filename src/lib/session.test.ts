/**
 * The session guards every page and action relies on (prompt S19 decision 2.3; plan §12 "a user
 * cannot grant themselves a role"). Admin actions call `requireRole` first (enforced by
 * `src/app/route-guards.test.ts`), so this proves the refusal they get: signed-out and
 * unverified users go to sign-in, and signed-in users without the role get a 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ROLES, type Role } from "@/lib/roles";

const getSession = vi.fn();
const getUserRoles = vi.fn<(db: unknown, id: string) => Promise<Role[]>>();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/db/queries/roles", () => ({ getUserRoles: (db: unknown, id: string) => getUserRoles(db, id) }));

const { requireRole, requireUser } = await import("./session");

function signedIn(roles: Role[], emailVerified = true) {
  getSession.mockResolvedValue({ user: { id: "u1", name: "U", email: "u@example.test", emailVerified } });
  getUserRoles.mockResolvedValue(roles);
}

const PLATFORM_ONLY = ["platform_admin"] as const;

describe("requireUser", () => {
  beforeEach(() => {
    getSession.mockReset();
    getUserRoles.mockReset();
  });

  it("sends signed-out visitors to sign-in, keeping where they were going", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireUser("/account/billing")).rejects.toThrow(/^REDIRECT \/sign-in\?next=%2Faccount%2Fbilling$/);
  });

  it("sends unverified accounts to sign-in too", async () => {
    signedIn(["buyer_tenant"], false);
    await expect(requireUser()).rejects.toThrow(/^REDIRECT \/sign-in/);
  });

  it("returns the verified user with roles read from the database", async () => {
    signedIn(["agent"]);
    await expect(requireUser()).resolves.toMatchObject({ id: "u1", roles: ["agent"] });
  });
});

describe("requireRole", () => {
  beforeEach(() => {
    getSession.mockReset();
    getUserRoles.mockReset();
  });

  it.each<[string, Role[]]>([
    ["buyer", ["buyer_tenant"]],
    ["owner", ["buyer_tenant", "owner"]],
    ["agent", ["buyer_tenant", "agent"]],
    ["agency admin", ["buyer_tenant", "agent", "agency_admin"]],
  ])("refuses a %s every admin area with a 404", async (_who, roles) => {
    signedIn(roles);
    await expect(requireRole(ADMIN_ROLES, "/admin/billing")).rejects.toThrow("NOT_FOUND");
    await expect(requireRole(PLATFORM_ONLY, "/admin/listings")).rejects.toThrow("NOT_FOUND");
  });

  it("keeps billing admins out of moderation and verification (platform admins only)", async () => {
    signedIn(["buyer_tenant", "billing_admin"]);
    await expect(requireRole(ADMIN_ROLES, "/admin/billing")).resolves.toMatchObject({ id: "u1" });
    await expect(requireRole(PLATFORM_ONLY, "/admin/verification")).rejects.toThrow("NOT_FOUND");
  });

  it("lets platform admins into both", async () => {
    signedIn(["buyer_tenant", "platform_admin"]);
    await expect(requireRole(ADMIN_ROLES)).resolves.toMatchObject({ id: "u1" });
    await expect(requireRole(PLATFORM_ONLY)).resolves.toMatchObject({ id: "u1" });
  });

  it("sends a signed-out visitor to sign-in rather than revealing the admin page", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireRole(ADMIN_ROLES, "/admin")).rejects.toThrow(/^REDIRECT \/sign-in/);
  });

  it("ignores a role claimed on the session object: only database roles count", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", name: "U", email: "u@example.test", emailVerified: true, roles: ["platform_admin"] } });
    getUserRoles.mockResolvedValue(["buyer_tenant"]);
    await expect(requireRole(PLATFORM_ONLY)).rejects.toThrow("NOT_FOUND");
  });
});
