import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";

/**
 * Compact green wordmark with the tagline underneath (white on the deep-green auth panel).
 * `overlay`: the site header's own logo, which turns white while the header is clear over the hero.
 */
export function Logo({
  tone = "brand",
  overlay = false,
  className,
}: {
  tone?: "brand" | "inverse";
  overlay?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex min-h-control flex-col justify-center rounded-sm leading-none",
        tone === "brand" ? "text-emerald-700" : "text-white",
        overlay && "group-has-[[data-header-overlay]]/header:text-white",
        className,
      )}
    >
      <span className="text-[15px] font-extrabold tracking-[-0.06em]">{BRAND.name}</span>
      <span
        className={cn(
          "mt-1 text-[9px] font-medium uppercase tracking-wide",
          tone === "brand" ? "text-slate-600" : "text-white/80",
          overlay && "group-has-[[data-header-overlay]]/header:text-white/80",
        )}
      >
        {BRAND.tagline}
      </span>
      <span className="sr-only">, home</span>
    </Link>
  );
}
