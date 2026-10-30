import Link from "next/link";
import { Chip } from "@/components/ui";
import { activeFilters, clearFiltersHref, type SearchFilters } from "@/lib/search/params";
import { SortSelect } from "./SortSelect";

export const HOW_RANKING_WORKS_HREF = "/how-it-works#ranking";

/** The disclosure under every results header (plan v2.0 §5 "Disclosure"; prompt S7 decision 8). */
export function RankingDisclosure() {
  return (
    <p className="text-body-sm text-slate-600">
      Verified listers appear first. Verification is a paid service that includes an identity and business check.{" "}
      <Link href={HOW_RANKING_WORKS_HREF} className="font-medium text-emerald-700 underline underline-offset-2 hover:text-ink">
        How ranking works
      </Link>
    </p>
  );
}

/** Active filter chips with Clear all, the sort control and the disclosure line. */
export function ResultsHeader({ filters }: { filters: SearchFilters }) {
  const chips = activeFilters(filters);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {chips.length > 0 && (
            <>
              <h2 className="text-body-sm text-slate-600">Active filters</h2>
              <ul className="mt-2 flex flex-wrap items-center gap-2">
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
                    className="inline-flex min-h-control items-center rounded-md px-2 text-body-sm font-semibold text-emerald-700 hover:bg-mint-50"
                  >
                    Clear all
                  </Link>
                </li>
              </ul>
            </>
          )}
        </div>
        <SortSelect value={filters.sort} />
      </div>
      <RankingDisclosure />
    </div>
  );
}
