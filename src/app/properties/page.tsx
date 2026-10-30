import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, cache } from "react";
import { SearchX } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { FilterDrawer } from "@/components/search/FilterDrawer";
import { FilterPanel } from "@/components/search/FilterPanel";
import { Pagination } from "@/components/search/Pagination";
import { PropertyCard, PropertyGridSkeleton } from "@/components/search/PropertyCard";
import { ResultsHeader } from "@/components/search/ResultsHeader";
import { SearchBar } from "@/components/search/SearchBar";
import { SearchPageSkeleton } from "@/components/search/SearchPageSkeleton";
import { VerifiedStrip } from "@/components/search/VerifiedStrip";
import { toCardData } from "@/components/search/card-data";
import { EmptyState, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { searchListings } from "@/db/queries/public-listings";
import type { SearchParams } from "@/lib/search-params";
import {
  MODE_CRUMBS,
  MODE_TITLES,
  activeFilters,
  clearFiltersHref,
  formDataToParams,
  hasActiveFilters,
  parseSearchParams,
  searchHref,
  type RawSearchParams,
  type SearchFilters,
} from "@/lib/search/params";

const MODE_DESCRIPTIONS = {
  buy: "Houses, apartments, land and commercial property for sale across Kenya.",
  rent: "Houses, apartments, land and commercial property to rent across Kenya.",
  land: "Plots and land for sale or lease across Kenya.",
} as const;

/** Only the plain mode pages are indexed; filtered, sorted and later pages are not (decision 14). */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { filters } = parseSearchParams(await searchParams);
  const narrowed = filters.page > 1 || filters.sort !== "recommended" || hasActiveFilters(filters);
  return {
    title: MODE_TITLES[filters.mode],
    description: MODE_DESCRIPTIONS[filters.mode],
    alternates: { canonical: searchHref({ mode: filters.mode }) },
    ...(narrowed ? { robots: { index: false, follow: true } } : {}),
  };
}

/** One search per request, shared by the count line and the results (keyed by canonical URL). */
const loadResults = cache(async (href: string) => {
  // Ranking reads the clock (recency, daily rotation), which must follow a request-time signal.
  await connection();
  const { filters } = parseSearchParams(formDataToParams(new URL(href, "http://localhost").searchParams.entries()));
  return searchListings(getDb(), filters);
});

function first(value: RawSearchParams[string]): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

async function ResultCount({ href }: { href: string }) {
  const { total } = await loadResults(href);
  return <>{total === 1 ? "1 listing" : `${total.toLocaleString("en-KE")} listings`}</>;
}

function NoResults({ filters }: { filters: SearchFilters }) {
  return (
    <EmptyState
      icon={<SearchX />}
      title="No properties match these filters"
      description="Try a wider area, a different price range or fewer filters."
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={clearFiltersHref(filters)} className={buttonClasses({ variant: "secondary" })}>
            Clear filters
          </Link>
          {filters.verified && (
            <Link href={searchHref({ ...filters, verified: false, page: 1 })} className={buttonClasses({ variant: "quiet" })}>
              Show all listers
            </Link>
          )}
        </div>
      }
    />
  );
}

async function Results({ href, filters }: { href: string; filters: SearchFilters }) {
  const result = await loadResults(href);
  if (result.total === 0) return <NoResults filters={filters} />;
  const shown = { ...filters, page: result.page };
  return (
    <>
      <VerifiedStrip listings={toCardData(result.verifiedStrip)} />
      <section aria-labelledby="results-heading">
        <h2 id="results-heading" className="sr-only">
          Results, page {result.page} of {result.pageCount}
        </h2>
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {toCardData(result.items).map((listing) => (
            <li key={listing.id} className="flex">
              <PropertyCard listing={listing} />
            </li>
          ))}
        </ul>
      </section>
      <Pagination filters={shown} page={result.page} pageCount={result.pageCount} />
    </>
  );
}

async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const { filters, errors } = parseSearchParams(raw);
  const href = searchHref(filters);
  const priceInput = errors.price ? { min: first(raw.minPrice), max: first(raw.maxPrice) } : undefined;
  return (
    <PageContainer className="flex flex-col gap-6 py-8 lg:py-10">
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-caption text-slate-600">
            <li>
              <Link href="/" className="-my-3.5 inline-flex min-h-control items-center hover:text-ink hover:underline">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{MODE_CRUMBS[filters.mode]}</li>
          </ol>
        </nav>
        <div>
          <h1 className="text-h1-sm md:text-h1">{MODE_TITLES[filters.mode]}</h1>
          <p className="mt-1 text-body-sm text-slate-600">
            <span role="status">
              <Suspense key={href} fallback="Counting listings…">
                <ResultCount href={href} />
              </Suspense>
            </span>{" "}
            · Browse homes, apartments, land and commercial property
          </p>
        </div>
      </div>

      {/* Keyed by the URL so the inputs reset after a chip, Clear all or pagination link. */}
      <SearchBar key={`bar:${href}`} filters={filters} />

      <div className="grid gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-8">
        <FilterDrawer key={`filters:${href}`} activeCount={activeFilters(filters).length} clearHref={clearFiltersHref(filters)}>
          <FilterPanel filters={filters} priceError={errors.price} priceInput={priceInput} />
        </FilterDrawer>
        <div className="flex min-w-0 flex-col gap-6">
          <ResultsHeader key={`header:${href}`} filters={filters} />
          <Suspense key={href} fallback={<PropertyGridSkeleton />}>
            <Results href={href} filters={filters} />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}

/** Public search (plan v2.0 §5, §9; prompt S7). Only published listings and public fields. */
export default function PropertiesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <SearchPage searchParams={searchParams} />
    </Suspense>
  );
}
