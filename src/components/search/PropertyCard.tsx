import Link from "next/link";
import { ListingImage } from "@/components/listings/ListingImage";
import { listingLocation } from "@/components/listings/ListingSummary";
import { Badge, Skeleton, VerifiedBadge } from "@/components/ui";
import type { PublicListingCard } from "@/db/queries/public-listings";
import { formatKes } from "@/lib/format";
import { RENT_SUFFIX, cardFacts, cardImageAlt } from "@/lib/search/card";

/** A public card with its cover resolved to a URL. The storage key never reaches the browser. */
export type PropertyCardData = Omit<PublicListingCard, "coverKey"> & { coverUrl: string | null };

/** `sizes` for the 1 / 2 / 3-column card grids inside the 1280px container. */
export const CARD_IMAGE_SIZES = "(min-width: 1280px) 400px, (min-width: 640px) 50vw, 100vw";

/**
 * Design "Property card - reusable" (prompt S7 decision 10). Cards are not links in S7: the
 * detail page arrives in S8, which passes `href` to stretch a link over the card.
 */
export function PropertyCard({
  listing,
  featured = false,
  href,
  sizes = CARD_IMAGE_SIZES,
}: {
  listing: PropertyCardData;
  featured?: boolean;
  href?: string;
  sizes?: string;
}) {
  const facts = cardFacts(listing);
  return (
    <article className="relative flex w-full flex-col overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <div className="relative">
        <ListingImage baseUrl={listing.coverUrl} alt={cardImageAlt(listing)} sizes={sizes} />
        {(listing.verified || featured) && (
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            {listing.verified && <VerifiedBadge className="bg-white shadow-card" />}
            {featured && <Badge className="bg-white text-ink shadow-card">Featured</Badge>}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4 md:p-5">
        <p className="text-h3 font-bold text-ink">
          {formatKes(listing.priceKes)}
          {listing.rentPeriod && <span> {RENT_SUFFIX[listing.rentPeriod]}</span>}
        </p>
        <h3 className="text-body font-medium text-ink">
          {href ? (
            <Link href={href} className="after:absolute after:inset-0 after:content-[''] hover:underline">
              {listing.title}
            </Link>
          ) : (
            listing.title
          )}
        </h3>
        <p className="text-body-sm text-slate-600">{listingLocation(listing)}</p>
        {facts.length > 0 && <p className="text-body-sm text-slate-600">{facts.join(" · ")}</p>}
        {listing.listerName && (
          <div className="mt-auto pt-3">
            <p className="flex items-center gap-2 border-t border-line pt-3 text-body-sm text-ink">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-ink" />
              <span className="sr-only">Listed by </span>
              {listing.listerName}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

export function PropertyCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="flex flex-col gap-3 p-4 md:p-5">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="mt-2 h-4 w-1/3" />
      </div>
    </div>
  );
}

/** Placeholder grid while results stream in. */
export function PropertyGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only">Loading properties…</span>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
