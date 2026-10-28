import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";

/** Design: green "VerifiedPropertiesKE" wordmark (white on the deep-green auth panel). */
export function Logo({ tone = "brand", className }: { tone?: "brand" | "inverse"; className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex min-h-control items-center rounded-sm text-h3 font-bold tracking-tight",
        tone === "brand" ? "text-emerald-700" : "text-white",
        className,
      )}
    >
      {BRAND.name}
      <span className="sr-only">, home</span>
    </Link>
  );
}
