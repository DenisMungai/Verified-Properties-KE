import type { ReactNode } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui";
import { activeFilters, clearFiltersHref, type SearchFilters } from "@/lib/search/params";
import { SortSelect } from "./SortSelect";

export const HOW_RANKING_WORKS_HREF = "/how-it-works#ranking";

/** The disclosure under every results header (plan v2.0 §5 "Disclosure"; prompt S7 decision 8). */
export function RankingDisclosure() {
  return (
    <p className="text-small text-slate-600">
      Verified listers appear first. Verification is a paid service that includes an identity and business check.{" "}
      <Link href={HOW_RANKING_WORKS_HREF} className="font-medium text-emerald-700 underline underline-offset-4 hover:text-ink">
        How ranking works
      </Link>
    </p>
  );
}

/** Active filter chips, the toolbar row (count left, sort right) and the disclosure line. */
export function ResultsHeader({ filters, count }: { filters: SearchFilters; count: ReactNode }) {
  const chips = activeFilters(filters);
  return (
    <div className="flex flex-col gap-3">
      {chips.length > 0 && (
        <div className="min-w-0">
          <h2 className="text-micro font-semibold uppercase tracking-wide text-slate-600">Active filters</h2>
          <ul className="mt-1.5 flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <li key={chip.id}>
                <Chip
                  removeHref={chip.href}
                  removeLabel={`Remove filter: ${chip.label}`}
                  className="border-transparent bg-mint-50 font-medium text-emerald-700"
                >
                  {chip.label}
                </Chip>
              </li>
            ))}
            <li>
              <Link
                href={clearFiltersHref(filters)}
                className="inline-flex min-h-control items-center rounded-md px-2 text-small font-semibold text-emerald-700 hover:bg-mint-50"
              >
                Clear all
              </Link>
            </li>
          </ul>
        </div>
      )}
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-y border-line py-1.5 text-small">
        <p className="font-medium text-ink">{count}</p>
        <SortSelect value={filters.sort} />
      </div>
      <RankingDisclosure />
    </div>
  );
}
