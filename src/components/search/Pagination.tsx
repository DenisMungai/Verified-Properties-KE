import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { pageHref, type SearchFilters } from "@/lib/search/params";

const WINDOW = 5;

/** 32px squares: the design's floor for secondary controls (WCAG 2.2 AA 2.5.8 needs 24px). */
const itemClasses =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded border px-2 text-small font-semibold transition-colors";

/** Up to five numbered pages around the current one; the current page and dead ends aren't links. */
export function pageWindow(page: number, pageCount: number): number[] {
  const start = Math.max(1, Math.min(page - Math.floor(WINDOW / 2), pageCount - WINDOW + 1));
  const end = Math.min(pageCount, start + WINDOW - 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function Edge({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} className={cn(itemClasses, "border-line text-slate-600")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(itemClasses, "border-line-strong bg-white text-ink hover:border-ink")}>
      {children}
    </Link>
  );
}

export function Pagination({ filters, page, pageCount }: { filters: SearchFilters; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination">
      <ul className="flex flex-wrap items-center justify-center gap-1.5">
        <li>
          <Edge href={page > 1 ? pageHref(filters, page - 1) : null} label="Previous page">
            <ChevronLeft aria-hidden="true" className="size-4" />
            <span className="hidden sm:inline">Previous</span>
          </Edge>
        </li>
        {pageWindow(page, pageCount).map((n) => (
          <li key={n}>
            {n === page ? (
              <span aria-current="page" className={cn(itemClasses, "border-emerald-600 bg-emerald-600 text-white")}>
                <span className="sr-only">Page </span>
                {n}
              </span>
            ) : (
              <Link href={pageHref(filters, n)} className={cn(itemClasses, "border-line-strong bg-white text-ink hover:border-ink")}>
                <span className="sr-only">Page </span>
                {n}
              </Link>
            )}
          </li>
        ))}
        <li>
          <Edge href={page < pageCount ? pageHref(filters, page + 1) : null} label="Next page">
            <span className="hidden sm:inline">Next</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Edge>
        </li>
      </ul>
    </nav>
  );
}
