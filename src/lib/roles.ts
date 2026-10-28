/**
 * Roles (plan v2.0 §6). They are written only by server code from the allowlists below, or by
 * the operator-only `scripts/create-admin.ts`. User input never names a role directly.
 */
export const ROLES = [
  "buyer_tenant",
  "owner",
  "agent",
  "agency_admin",
  "platform_admin",
  "billing_admin",
] as const;
export type Role = (typeof ROLES)[number];

/** Granted automatically to every new account. */
export const SIGN_UP_ROLE = "buyer_tenant" satisfies Role;

export const LISTER_TYPES = ["agent", "owner", "developer"] as const;
export type ListerType = (typeof LISTER_TYPES)[number];

export const LISTER_TYPE_LABELS: Record<ListerType, string> = {
  agent: "Agent",
  owner: "Private owner",
  developer: "Developer",
};

/** The lister role that creating a lister profile grants. Developers list their own projects. */
const LISTER_ROLE_BY_TYPE: Record<ListerType, Extract<Role, "agent" | "owner">> = {
  agent: "agent",
  owner: "owner",
  developer: "owner",
};

export function listerRoleFor(type: ListerType): "agent" | "owner" {
  return LISTER_ROLE_BY_TYPE[type];
}

/** Roles only an operator script may grant. */
export const OPERATOR_GRANTABLE_ROLES = ["platform_admin", "billing_admin"] as const satisfies readonly Role[];
export type OperatorRole = (typeof OPERATOR_GRANTABLE_ROLES)[number];

export const LISTER_ROLES = ["owner", "agent", "agency_admin"] as const satisfies readonly Role[];
export const ADMIN_ROLES = ["platform_admin", "billing_admin"] as const satisfies readonly Role[];

export function hasAnyRole(roles: readonly Role[], wanted: readonly Role[]): boolean {
  return wanted.some((role) => roles.includes(role));
}
