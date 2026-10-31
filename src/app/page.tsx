import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, House } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { HomeSearch } from "@/components/search/HomeSearch";
import { LocationTiles } from "@/components/search/LocationTiles";
import { CARD_GRID, PropertyCard, PropertyGridSkeleton } from "@/components/search/PropertyCard";
import { HOW_RANKING_WORKS_HREF } from "@/components/search/ResultsHeader";
import { saveContextFor, saveProps, toCardData } from "@/components/search/card-data";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { homeShowcase } from "@/db/queries/public-listings";
import { SEARCH_PATH } from "@/lib/search/params";

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
    <div className="flex flex-col">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-title">{showcase ? "Verified homes worth a closer look" : "Newest listings"}</h2>
          <p className="text-small text-slate-600">
            {showcase ? (
              <>
                Featured listings come from verified listers, a paid service.{" "}
                <Link href={HOW_RANKING_WORKS_HREF} className="font-medium text-emerald-700 underline underline-offset-4 hover:text-ink">
                  How it works
                </Link>
              </>
            ) : (
              "The latest homes, apartments, land and commercial property on the marketplace."
            )}
          </p>
        </div>
        <Link
          href={SEARCH_PATH}
          className="inline-flex min-h-control items-center gap-1 self-start text-small font-medium text-ink underline-offset-4 hover:underline sm:self-auto"
        >
          Browse all properties
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <ul className={CARD_GRID}>
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
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-72 max-w-full" />
      <PropertyGridSkeleton count={4} />
    </div>
  );
}

/** Compact editorial homepage: bordered hero card, search card, location rail, listings. */
export default function HomePage() {
  return (
    <PageContainer className="flex flex-col gap-16 pb-8 pt-6">
      <div className="flex flex-col gap-4">
        <section
          aria-labelledby="hero-heading"
          className="grid min-h-[400px] overflow-hidden rounded-xl border border-line bg-white sm:min-h-[520px] lg:grid-cols-[52fr_48fr]"
        >
          <div className="flex flex-col items-start justify-center p-7 sm:p-10 lg:p-12">
            <p className="inline-flex rounded-sm bg-mint-50 px-2 py-1 text-micro font-medium uppercase tracking-wide text-emerald-700">
              Kenya property marketplace
            </p>
            <h1
              id="hero-heading"
              className="mt-5 text-[2.5rem] font-bold leading-[0.98] tracking-[-0.055em] text-ink sm:text-[clamp(2.6rem,5.8vw,4.75rem)]"
            >
              Find a place to call your own.
            </h1>
            <p className="mt-4 max-w-md text-body text-slate-600">
              Discover homes, apartments and land from property professionals you can trust.
            </p>
            <Link href={SEARCH_PATH} className={buttonClasses({ className: "mt-7" })}>
              Browse all properties
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <div aria-hidden="true" className="hidden items-end justify-center bg-mint-50 px-10 pt-12 lg:flex">
            <div className="relative flex h-4/5 w-full max-w-sm items-end justify-center rounded-t-lg bg-[#C9DDCF]">
              <div className="absolute inset-x-8 bottom-0 top-10 rounded-t-md bg-canvas" />
              <div className="absolute left-14 top-16 size-12 rounded-sm bg-[#B7D2BF]" />
              <div className="absolute right-14 top-16 size-12 rounded-sm bg-[#B7D2BF]" />
              <div className="relative h-28 w-16 rounded-t-sm bg-emerald-700" />
            </div>
          </div>
        </section>
        <HomeSearch />
      </div>

      <section aria-labelledby="locations-heading">
        <div className="mb-4 flex flex-col gap-1">
          <h2 id="locations-heading" className="text-title">
            Explore popular locations
          </h2>
          <p className="text-small text-slate-600">Start with a county you love.</p>
        </div>
        <LocationTiles />
      </section>

      <section aria-label="Listings">
        <Suspense fallback={<HomeListingsSkeleton />}>
          <HomeListings />
        </Suspense>
      </section>
    </PageContainer>
  );
}
