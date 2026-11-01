import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, House } from "lucide-react";
import heroImage from "@/assets/images/home-hero.jpg";
import { PageContainer } from "@/components/layout/PageContainer";
import { HomeSearch } from "@/components/search/HomeSearch";
import { LocationTiles } from "@/components/search/LocationTiles";
import { HOME_CARD_GRID, HOME_CARD_IMAGE_SIZES, PropertyCard, PropertyGridSkeleton } from "@/components/search/PropertyCard";
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
      <ul className={HOME_CARD_GRID}>
        {toCardData(featured).map((listing) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} featured save={saveProps(saveContext, listing.id)} sizes={HOME_CARD_IMAGE_SIZES} />
          </li>
        ))}
        {toCardData(newest).map((listing) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} save={saveProps(saveContext, listing.id)} sizes={HOME_CARD_IMAGE_SIZES} />
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
      <PropertyGridSkeleton count={4} grid={HOME_CARD_GRID} />
    </div>
  );
}

/** Compact editorial homepage: full-bleed hero under the header, then search card, location rail, listings. */
export default function HomePage() {
  return (
    <>
      <section
        aria-labelledby="hero-heading"
        className="relative isolate -mt-[67px] flex min-h-[467px] w-full items-center overflow-hidden border-b border-line bg-ink pt-[67px] sm:min-h-[587px]"
      >
        {/* Slides up 67px (66px bar + 1px border) behind the sticky header. Decorative: the H1 carries the meaning; phones crop towards the house. */}
        <Image
          src={heroImage}
          alt=""
          fill
          preload
          placeholder="blur"
          sizes="100vw"
          className="-z-20 object-cover object-[70%_center] lg:object-center"
        />
        {/* Charcoal wash keeps white text readable; from lg it fades out so the house stays bright. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-ink/55 lg:bg-transparent lg:bg-gradient-to-r lg:from-ink/80 lg:via-ink/45 lg:to-transparent"
        />
        {/* Top fade: the header is clear over the hero, so its white links need a darker band behind them. */}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-ink/60 to-transparent" />
        {/* Side padding matches PageContainer; past 1440px it grows so the text lines up with the page below. */}
        <div className="flex w-full flex-col items-start justify-center px-4 py-10 sm:px-5 sm:py-14 md:px-page-x lg:py-16 lg:pl-[max(4vw,calc(50vw-720px+4vw))] lg:pr-12">
          <div className="flex max-w-xl flex-col items-start">
            <p className="inline-flex rounded-sm bg-mint-50 px-2 py-1 text-micro font-medium uppercase tracking-wide text-emerald-700">
              Kenya property marketplace
            </p>
            <h1
              id="hero-heading"
              className="mt-5 text-[2.5rem] font-bold leading-[0.98] tracking-[-0.055em] text-white sm:text-[clamp(2.6rem,5.8vw,4.75rem)]"
            >
              Find a place to call your own.
            </h1>
            <p className="mt-4 max-w-md text-body text-white/90">
              Discover homes, apartments and land from property professionals you can trust.
            </p>
            <Link href={SEARCH_PATH} className={buttonClasses({ className: "mt-7" })}>
              Browse all properties
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <PageContainer className="flex flex-col gap-16 pb-8 pt-6">
        <HomeSearch />

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
    </>
  );
}
