import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { AgencyDirectoryCard } from "@/components/agency/AgencyDirectoryCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { Pagination } from "@/components/search/Pagination";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { listAgencyDirectory } from "@/db/queries/public-agencies";
import { SEARCH_PATH } from "@/lib/search/params";
import { single, type SearchParams } from "@/lib/search-params";
import { publicImageBaseUrl } from "@/lib/storage";

/**
 * Agency directory (prompt S24): agencies with published listings, most listings first. Only public
 * fields are read; each card opens the agency's page.
 */

const DIRECTORY_PATH = "/agencies";
const GRID = "grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4";

function pageOf(value: string | string[] | undefined): number {
  const n = Number(single(value));
  return Number.isInteger(n) && n > 1 && n < 10_000 ? n : 1;
}

const directoryPath = (page: number) => (page > 1 ? `${DIRECTORY_PATH}?page=${page}` : DIRECTORY_PATH);

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const page = pageOf((await searchParams).page);
  return {
    title: "Property agencies in Kenya",
    description: "Browse property agencies on VerifiedPropertiesKE and see every home, plot and commercial space they list.",
    alternates: { canonical: DIRECTORY_PATH },
    ...(page > 1 ? { robots: { index: false } } : {}),
  };
}

function DirectorySkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading agencies</span>
      <ul className={GRID}>
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <Skeleton className="h-[66px] w-full rounded-sm" />
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Directory({ searchParams }: { searchParams: SearchParams }) {
  const page = pageOf((await searchParams).page);
  await connection();
  const result = await listAgencyDirectory(getDb(), page);
  if (result.total === 0) {
    return (
      <EmptyState
        icon={<Building2 />}
        title="No agencies yet"
        description="Agencies appear here once they publish a listing."
        action={
          <Link href={SEARCH_PATH} className={buttonClasses()}>
            Explore properties
          </Link>
        }
      />
    );
  }
  return (
    <section aria-labelledby="directory-heading" className="flex flex-col gap-4">
      <h2 id="directory-heading" className="sr-only">
        Agencies, page {result.page} of {result.pageCount}
      </h2>
      <p className="text-micro text-slate-600">
        {result.total} {result.total === 1 ? "agency" : "agencies"} · Sorted by number of listings
      </p>
      <ul className={GRID}>
        {result.items.map((agency) => (
          <li key={agency.slug} className="flex">
            <AgencyDirectoryCard
              name={agency.name}
              slug={agency.slug}
              logoUrl={publicImageBaseUrl(agency.logoKey)}
              listingCount={agency.listingCount}
            />
          </li>
        ))}
      </ul>
      <Pagination hrefFor={directoryPath} page={result.page} pageCount={result.pageCount} />
    </section>
  );
}

export default function AgenciesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer className="flex flex-col gap-6 pb-10 pt-6 md:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-display-sm">Agencies</h1>
        <p className="max-w-2xl text-body text-slate-600">
          Property agencies listing on VerifiedPropertiesKE. Open one to see its team and every property it lists.
        </p>
      </div>
      <Suspense fallback={<DirectorySkeleton />}>
        <Directory searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
