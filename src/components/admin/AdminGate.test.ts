/** AdminGate (S19 finding F1): children only after the role check passes. */
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));

const { AdminGate } = await import("./AdminGate");

describe("AdminGate", () => {
  it("checks the given roles and then renders its children", async () => {
    requireRole.mockResolvedValueOnce({ id: "admin" });
    const child = createElement("h1", null, "Billing");
    const out = await AdminGate({ roles: ["platform_admin", "billing_admin"], next: "/admin/billing", children: child });
    expect(requireRole).toHaveBeenCalledWith(["platform_admin", "billing_admin"], "/admin/billing");
    expect(out.props.children).toBe(child);
  });

  it("renders nothing when the role check refuses", async () => {
    requireRole.mockRejectedValueOnce(new Error("NOT_FOUND"));
    await expect(AdminGate({ roles: ["platform_admin"], next: "/admin", children: createElement("h1", null, "Admin") })).rejects.toThrow("NOT_FOUND");
  });
});
