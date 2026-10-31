import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";

/** Compact green wordmark with the tagline underneath (white on the deep-green auth panel). */
export function Logo({ tone = "brand", className }: { tone?: "brand" | "inverse"; className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex min-h-control flex-col justify-center rounded-sm leading-none",
        tone === "brand" ? "text-emerald-700" : "text-white",
        className,
      )}
    >
      <span className="text-[15px] font-extrabold tracking-[-0.06em]">{BRAND.name}</span>
      <span
        className={cn(
          "mt-1 text-[9px] font-medium uppercase tracking-wide",
          tone === "brand" ? "text-slate-600" : "text-white/80",
        )}
      >
        {BRAND.tagline}
      </span>
      <span className="sr-only">, home</span>
    </Link>
  );
}
