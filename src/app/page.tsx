import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, House } from "lucide-react";
import heroImage from "@/assets/images/home-hero.jpg";
import { PageContainer } from "@/components/layout/PageContainer";
import { HomeSearch } from "@/components/search/HomeSearch";
import { LocationTiles } from "@/components/search/LocationTiles";
import { HOME_CARD_GRID, PropertyGridSkeleton } from "@/components/search/PropertyCard";
import { FeaturedDisclosure, ShowcaseSection } from "@/components/search/ShowcaseSection";
import { saveContextFor } from "@/components/search/card-data";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { homeSections } from "@/db/queries/public-listings";
import { SEARCH_PATH, searchHref } from "@/lib/search/params";
import { HOME_COUNTY, HOME_COUNTY_SLOTS, HOME_SLOTS } from "@/lib/search/ranking";

/**
 * The home listings (plan v2.0 §5 "Home page"; prompts S7 decision 9 and S14): the site-wide
 * section, then the county section, which never repeats a card. Featured cards are verified
 * listers' only; the newest fill the rest without the label.
 */
async function HomeListings() {
  // The rotation seed reads the clock, which must follow a request-time signal.
  await connection();
  const { main, county } = await homeSections(getDb());

  if (main.featured.length === 0 && main.newest.length === 0) {
    return (
      <section aria-label="Listings">
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
      </section>
    );
  }

  const ids = [main, county].flatMap((section) => [...section.featured, ...section.newest]).map((card) => card.id);
  const saveContext = await saveContextFor(ids, "/");
  const mainFeatured = main.featured.length > 0;
  const countyFeatured = county.featured.length > 0;
  const countyShown = countyFeatured || county.newest.length > 0;
  return (
    <>
      <ShowcaseSection
        id="home-listings"
        heading={mainFeatured ? "Verified homes worth a closer look" : "Newest listings"}
        subline={
          mainFeatured ? <FeaturedDisclosure /> : "The latest homes, apartments, land and commercial property on the marketplace."
        }
        link={{ href: SEARCH_PATH, label: "Browse all properties" }}
        showcase={main}
        saveContext={saveContext}
      />
      {countyShown && (
        <ShowcaseSection
          id="home-county"
          heading={countyFeatured ? `Featured in ${HOME_COUNTY}` : `Newest in ${HOME_COUNTY}`}
          subline={countyFeatured ? <FeaturedDisclosure /> : `The latest listings in ${HOME_COUNTY} County.`}
          link={{ href: searchHref({ q: HOME_COUNTY }), label: `See all in ${HOME_COUNTY}` }}
          showcase={county}
          saveContext={saveContext}
        />
      )}
    </>
  );
}

function HomeListingsSkeleton() {
  return (
    <div className="flex flex-col gap-16" aria-busy="true">
      <span className="sr-only">Loading listings</span>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-72 max-w-full" />
        <PropertyGridSkeleton count={HOME_SLOTS} grid={HOME_CARD_GRID} />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-56 max-w-full" />
        <PropertyGridSkeleton count={HOME_COUNTY_SLOTS} grid={HOME_CARD_GRID} />
      </div>
    </div>
  );
}

/** Compact editorial homepage: full-bleed hero under the header, then search card, location rail, listings. */
export default function HomePage() {
  return (
    <>
      <section
        aria-labelledby="hero-heading"
        className="relative isolate -mt-[67px] flex min-h-[360px] w-full items-center overflow-hidden border-b border-line bg-ink pt-[67px] sm:min-h-[400px] lg:min-h-[440px]"
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
        <div className="flex w-full flex-col items-start justify-center px-4 py-8 sm:px-5 sm:py-10 md:px-page-x lg:py-12 lg:pl-[max(4vw,calc(50vw-720px+4vw))] lg:pr-12">
          <div className="flex max-w-xl flex-col items-start">
            <p className="inline-flex rounded-sm bg-mint-50 px-2 py-1 text-micro font-medium uppercase tracking-wide text-emerald-700">
              Kenya property marketplace
            </p>
            <h1
              id="hero-heading"
              className="mt-4 text-[2.25rem] font-bold leading-[0.98] tracking-[-0.055em] text-white sm:text-[clamp(2.4rem,4.4vw,3.5rem)]"
            >
              Find a place to call your own.
            </h1>
            <p className="mt-3 max-w-md text-body text-white/90">
              Discover homes, apartments and land from property professionals you can trust.
            </p>
            <Link href={SEARCH_PATH} className={buttonClasses({ className: "mt-5" })}>
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

        <Suspense fallback={<HomeListingsSkeleton />}>
          <HomeListings />
        </Suspense>
      </PageContainer>
    </>
  );
}
