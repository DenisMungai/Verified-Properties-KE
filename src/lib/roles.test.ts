import { describe, expect, it } from "vitest";
import { LISTER_TYPES, OPERATOR_GRANTABLE_ROLES, SIGN_UP_ROLE, hasAnyRole, listerRoleFor } from "./roles";

describe("roles", () => {
  it("grants only buyer_tenant at sign-up", () => {
    expect(SIGN_UP_ROLE).toBe("buyer_tenant");
  });

  it("maps every lister type to a non-privileged lister role", () => {
    expect(listerRoleFor("agent")).toBe("agent");
    expect(listerRoleFor("owner")).toBe("owner");
    expect(listerRoleFor("developer")).toBe("owner");
    for (const type of LISTER_TYPES) {
      expect(OPERATOR_GRANTABLE_ROLES).not.toContain(listerRoleFor(type));
    }
  });

  it("checks role membership", () => {
    expect(hasAnyRole(["buyer_tenant", "agent"], ["agent", "owner"])).toBe(true);
    expect(hasAnyRole(["buyer_tenant"], ["platform_admin"])).toBe(false);
  });
});
