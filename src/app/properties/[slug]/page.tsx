import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, cache } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Description } from "@/components/listing/Description";
import { FactsList } from "@/components/listing/FactsList";
import { Gallery } from "@/components/listing/Gallery";
import { ListerPanel, type Viewer } from "@/components/listing/ListerPanel";
import { ReportForm } from "@/components/listing/ReportForm";
import { SaveButton } from "@/components/listing/SaveButton";
import { listingLocation } from "@/components/listings/ListingSummary";
import { CardRail } from "@/components/search/CardRail";
import { PropertyCard, listingHref } from "@/components/search/PropertyCard";
import { saveContextFor, saveProps, toCardData } from "@/components/search/card-data";
import { Skeleton, VerifiedBadge, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { getListerContact, hasInquired } from "@/db/queries/inquiries";
import { getPublicListing, type PublicListingDetail } from "@/db/queries/listing-detail";
import { getManageableListing } from "@/db/queries/listings";
import { similarListings } from "@/db/queries/public-listings";
import { formatKes, formatNairobiDate } from "@/lib/format";
import { contactVisibility, visibleContact } from "@/lib/listings/contact";
import { signInPath } from "@/lib/safe-redirect";
import { RENT_SUFFIX } from "@/lib/search/card";
import { MODE_LABELS, searchHref, type SearchMode } from "@/lib/search/params";
import { getCurrentUser } from "@/lib/session";
import { publicImageBaseUrl } from "@/lib/storage";
import { variantSuffix } from "@/lib/storage/limits";

type Params = Promise<{ slug: string }>;

/** One read per request, shared by the metadata and the page. */
const loadListing = cache((slug: string) => getPublicListing(getDb(), slug));

function modeOf(listing: Pick<PublicListingDetail, "category" | "listingType">): SearchMode {
  if (listing.category === "land") return "land";
  return listing.listingType === "rent" ? "rent" : "buy";
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadListing(slug);
  if (!result) return { title: "Listing not found", robots: { index: false } };
  const { listing } = result;
  const cover = publicImageBaseUrl(listing.photos[0]?.storageKey);
  const image = cover?.startsWith("http") ? `${cover}${variantSuffix(960)}` : null;
  const description = listing.description.replace(/\s+/g, " ").trim().slice(0, 155);
  return {
    title: listing.title,
    description,
    alternates: { canonical: listingHref(listing.slug) },
    openGraph: { title: listing.title, description, ...(image ? { images: [{ url: image, width: 960 }] } : {}) },
  };
}

function Breadcrumbs({ listing }: { listing: PublicListingDetail }) {
  const mode = modeOf(listing);
  const place = listing.neighbourhood || listing.town;
  const crumbs = [
    { href: "/", label: "Home" },
    { href: searchHref({ mode }), label: MODE_LABELS[mode] },
    { href: searchHref({ mode, q: listing.county }), label: listing.county },
    ...(place.toLowerCase() !== listing.county.toLowerCase() ? [{ href: searchHref({ mode, q: place }), label: place }] : []),
  ];
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 text-small text-slate-600">
        {crumbs.map((crumb, i) => (
          <li key={crumb.href} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">/</span>}
            <Link href={crumb.href} className="-my-3.5 inline-flex min-h-control items-center hover:text-ink hover:underline">
              {crumb.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

async function SimilarListings({ listing }: { listing: PublicListingDetail }) {
  // The card query reads the clock (recency score), which must follow a request-time signal.
  await connection();
  const similar = await similarListings(getDb(), listing);
  if (similar.length === 0) return null;
  const context = await saveContextFor(
    similar.map((card) => card.id),
    listingHref(listing.slug),
  );
  return (
    <CardRail headingId="similar-heading" heading="Similar listings">
      {toCardData(similar).map((card) => (
        <li key={card.id}>
          <PropertyCard listing={card} save={saveProps(context, card.id)} sizes="320px" />
        </li>
      ))}
    </CardRail>
  );
}

async function ListingDetail({ params }: { params: Params }) {
  const { slug } = await params;
  const result = await loadListing(slug);
  if (!result) notFound();
  const { listing, ownerUserId } = result;
  const path = listingHref(listing.slug);
  const db = getDb();

  const user = await getCurrentUser();
  const signedIn = user?.emailVerified ? user : null;
  const [mine, inquired] = signedIn
    ? await Promise.all([
        getManageableListing(db, signedIn.id, listing.id).then(Boolean),
        hasInquired(db, signedIn.id, listing.id),
      ])
    : [false, false];

  // The contact rule is applied here, on the server: hidden details never reach the page.
  const visibility = contactVisibility({ listerVerified: listing.verified, viewerHasInquired: inquired });
  const contact =
    visibility === "hidden" || mine ? { phone: null, email: null } : visibleContact(await getListerContact(db, ownerUserId), visibility);

  const viewer: Viewer = !signedIn
    ? { kind: "signed_out", signInHref: signInPath(path) }
    : mine
      ? { kind: "own" }
      : { kind: "buyer", defaults: { fullName: signedIn.name, email: signedIn.email } };

  const saveContext = await saveContextFor([listing.id], path);
  const photos = listing.photos.map((photo) => ({ baseUrl: publicImageBaseUrl(photo.storageKey), alt: photo.altText }));

  return (
    <>
      <PageContainer className="flex flex-col gap-6 pb-28 pt-6 lg:gap-10 lg:pb-8">
        <div className="flex flex-col gap-3">
          <Breadcrumbs listing={listing} />
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-display-sm">{listing.title}</h1>
            {!mine && <SaveButton {...saveProps(saveContext, listing.id)} />}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {listing.verified && <VerifiedBadge className="py-1.5" />}
            <p className="text-small text-slate-600">
              {listingLocation(listing)}
              {listing.publishedAt && <> · Listed {formatNairobiDate(listing.publishedAt)}</>}
            </p>
          </div>
        </div>

        <Gallery photos={photos} title={listing.title} />

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16 xl:grid-cols-[minmax(0,1fr)_480px]">
          <div className="flex min-w-0 max-w-3xl flex-col gap-8">
            <section aria-labelledby="about-heading" className="flex flex-col gap-3">
              <h2 id="about-heading" className="text-title">
                About this property
              </h2>
              <Description text={listing.description} />
            </section>
            <FactsList listing={listing} />
            <div className="border-t border-line pt-6">
              {viewer.kind === "buyer" ? (
                <ReportForm listingId={listing.id} />
              ) : viewer.kind === "signed_out" ? (
                <Link href={viewer.signInHref} className="inline-flex min-h-control items-center text-small font-semibold text-slate-700 hover:text-ink">
                  Sign in to report this listing
                </Link>
              ) : null}
            </div>
          </div>
          <aside aria-label="Price and contact" className="lg:sticky lg:top-24 lg:self-start">
            <ListerPanel
              listing={listing}
              avatarUrl={publicImageBaseUrl(listing.listerAvatarKey)}
              contact={contact}
              visibility={visibility}
              viewer={viewer}
            />
          </aside>
        </div>

        <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
          <SimilarListings listing={listing} />
        </Suspense>
      </PageContainer>

      {/* Mobile: price and a jump to the contact card stay in reach. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white px-4 py-3 lg:hidden">
        <div className="mx-auto flex max-w-page items-center justify-between gap-4">
          <p className="text-title font-bold text-ink">
            {formatKes(listing.priceKes)}
            {listing.rentPeriod && <span className="text-small font-normal text-slate-600"> {RENT_SUFFIX[listing.rentPeriod]}</span>}
          </p>
          <a href="#contact" className={buttonClasses()}>
            Contact lister
          </a>
        </div>
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <PageContainer className="pb-8 pt-6">
      <div aria-busy="true" className="flex flex-col gap-6">
        <span className="sr-only">Loading listing…</span>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="aspect-[4/3] w-full rounded-xl lg:aspect-auto lg:h-[28rem]" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="h-64" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    </PageContainer>
  );
}

/** Public listing detail (plan v2.0 §9; prompt S8). Published listings only; anything else is a 404. */
export default function ListingPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <ListingDetail params={params} />
    </Suspense>
  );
}
