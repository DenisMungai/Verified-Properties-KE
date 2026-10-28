import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("keeps a custom font size alongside a text colour", () => {
    expect(cn("text-h1 text-ink")).toBe("text-h1 text-ink");
  });

  it("lets a later font size override an earlier one", () => {
    expect(cn("text-body", "text-h2")).toBe("text-h2");
  });

  it("lets a later colour override an earlier one", () => {
    expect(cn("bg-emerald-600", "bg-danger")).toBe("bg-danger");
  });
});
