import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, House } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { HomeSearch } from "@/components/search/HomeSearch";
import { LocationTiles } from "@/components/search/LocationTiles";
import { PropertyCard, PropertyGridSkeleton } from "@/components/search/PropertyCard";
import { HOW_RANKING_WORKS_HREF } from "@/components/search/ResultsHeader";
import { saveContextFor, saveProps, toCardData } from "@/components/search/card-data";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { homeShowcase } from "@/db/queries/public-listings";
import { SEARCH_PATH } from "@/lib/search/params";

const HOME_GRID = "grid gap-6 sm:grid-cols-2 xl:grid-cols-3";

/**
 * Verified featured listings when any qualify, otherwise the newest without a Featured label
 * (plan v2.0 §5 "Home page"; prompt S7 decision 9).
 */
async function HomeListings() {
  // The rotation seed reads the clock, which must follow a request-time signal.
  await connection();
  const { featured, newest } = await homeShowcase(getDb());

  if (featured.length === 0 && newest.length === 0) {
    return (
      <EmptyState
        icon={<House />}
        title="No listings yet"
        description="Published homes, apartments and land will appear here."
        action={
          <Link href="/sign-up?intent=list" className={buttonClasses()}>
            List your property
          </Link>
        }
      />
    );
  }

  const showcase = featured.length > 0;
  const saveContext = await saveContextFor([...featured, ...newest].map((card) => card.id), "/");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2">
            {showcase ? "Verified homes worth a closer look" : "Newest listings"}
          </h2>
          <p className="text-body-sm text-slate-600">
            {showcase ? (
              <>
                Featured listings come from verified listers, a paid service.{" "}
                <Link href={HOW_RANKING_WORKS_HREF} className="font-medium text-emerald-700 underline underline-offset-2 hover:text-ink">
                  How it works
                </Link>
              </>
            ) : (
              "The latest homes, apartments, land and commercial property on the marketplace."
            )}
          </p>
        </div>
        <Link href={SEARCH_PATH} className={buttonClasses({ variant: "secondary", className: "self-start sm:self-auto" })}>
          Browse all properties
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <ul className={HOME_GRID}>
        {toCardData(featured).map((listing) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} featured save={saveProps(saveContext, listing.id)} />
          </li>
        ))}
        {toCardData(newest).map((listing) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} save={saveProps(saveContext, listing.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function HomeListingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-72 max-w-full" />
      <PropertyGridSkeleton className={HOME_GRID} count={3} />
    </div>
  );
}

/** Design "01 — Homepage" and "06 — Mobile Homepage", with the mock's heading overlap fixed. */
export default function HomePage() {
  return (
    <>
      <PageContainer className="grid items-center gap-8 pb-8 pt-10 lg:grid-cols-2 lg:gap-10 lg:pb-20 lg:pt-16">
        <div className="flex flex-col items-start">
          <p className="text-label uppercase text-emerald-700">Kenya property marketplace</p>
          <h1 className="mt-4 text-display-sm md:text-display">Find a place to call your own.</h1>
          <p className="mt-4 max-w-prose text-body-lg text-slate-600">
            Discover homes, apartments and land from property professionals you can trust.
          </p>
        </div>
        <div aria-hidden="true" className="flex h-56 items-end justify-center rounded-2xl bg-mint-50 px-10 pt-10 md:h-72 lg:h-96">
          <div className="relative flex h-4/5 w-full max-w-sm items-end justify-center rounded-t-xl bg-[#C9DDCF]">
            <div className="absolute inset-x-8 bottom-0 top-10 rounded-t-lg bg-canvas" />
            <div className="absolute left-14 top-16 size-12 rounded-sm bg-[#B7D2BF]" />
            <div className="absolute right-14 top-16 size-12 rounded-sm bg-[#B7D2BF]" />
            <div className="relative h-28 w-16 rounded-t-sm bg-emerald-700" />
          </div>
        </div>
      </PageContainer>

      <PageContainer className="relative z-10 lg:-mt-12">
        <HomeSearch />
      </PageContainer>

      <section aria-labelledby="locations-heading">
        <PageContainer className="flex flex-col gap-6 py-12 lg:py-16">
          <div className="flex flex-col gap-1">
            <h2 id="locations-heading" className="text-h2">
              Explore popular locations
            </h2>
            <p className="text-body-sm text-slate-600">Start with a county you love.</p>
          </div>
          <LocationTiles />
        </PageContainer>
      </section>

      <section aria-label="Listings">
        <PageContainer className="pb-16 lg:pb-24">
          <Suspense fallback={<HomeListingsSkeleton />}>
            <HomeListings />
          </Suspense>
        </PageContainer>
      </section>
    </>
  );
}
