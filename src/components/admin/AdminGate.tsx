import "server-only";
import type { ReactNode } from "react";
import type { Role } from "@/lib/roles";
import { requireRole } from "@/lib/session";

/**
 * Renders an admin page's heading and content only after the role check (S19 finding F1).
 * Without it, a page's heading sits in the prerendered shell, and anyone sending any session
 * cookie past `src/proxy.ts` would see admin page titles. Wrap the whole page body in
 * `<Suspense><AdminGate …>…</AdminGate></Suspense>`; the inner data components keep their own
 * `requireRole` as well.
 */
export async function AdminGate({ roles, next, children }: { roles: readonly Role[]; next: string; children: ReactNode }) {
  await requireRole(roles, next);
  return <>{children}</>;
}
