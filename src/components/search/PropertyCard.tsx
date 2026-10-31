import Link from "next/link";
import { ListingImage } from "@/components/listings/ListingImage";
import { listingLocation } from "@/components/listings/ListingSummary";
import { SaveButton, type SaveButtonProps } from "@/components/listing/SaveButton";
import { Badge, Skeleton, VerifiedBadge } from "@/components/ui";
import type { PublicListingCard } from "@/db/queries/public-listings";
import { formatKes } from "@/lib/format";
import { RENT_SUFFIX, cardFacts, cardImageAlt } from "@/lib/search/card";

/** A public card with its cover resolved to a URL. The storage key never reaches the browser. */
export type PropertyCardData = Omit<PublicListingCard, "coverKey"> & { coverUrl: string | null };

/** `sizes` for the 2 / 3 / 4-column card grids inside the 1440px shell. */
export const CARD_IMAGE_SIZES = "(min-width: 1280px) 340px, (min-width: 640px) 33vw, 50vw";

/** The compact card grid: 2 columns even on phones, 3 from sm, 4 from xl. */
export const CARD_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4";

export function listingHref(slug: string): string {
  return `/properties/${slug}`;
}

/**
 * Compact property card (prompt ui-compact-design-system decision 10): square photo, badges
 * bottom-left, heart top-right. The title link is stretched over the whole card; the heart sits
 * above it so both stay usable.
 */
export function PropertyCard({
  listing,
  featured = false,
  save,
  sizes = CARD_IMAGE_SIZES,
}: {
  listing: PropertyCardData;
  featured?: boolean;
  /** The heart; omitted where saving doesn't apply. */
  save?: SaveButtonProps;
  sizes?: string;
}) {
  const facts = cardFacts(listing);
  return (
    <article className="relative flex w-full flex-col overflow-hidden rounded-sm border border-line bg-white transition-shadow duration-200 hover:shadow-sm has-[h3_a:focus-visible]:outline has-[h3_a:focus-visible]:outline-2 has-[h3_a:focus-visible]:outline-offset-2 has-[h3_a:focus-visible]:outline-emerald-600">
      <div className="relative">
        <ListingImage
          baseUrl={listing.coverUrl}
          alt={cardImageAlt(listing)}
          sizes={sizes}
          className="aspect-square border-b border-line"
        />
        {(listing.verified || featured) && (
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
            {listing.verified && <VerifiedBadge className="rounded-sm bg-white px-2 font-medium" />}
            {featured && <Badge className="rounded-sm bg-white px-2 font-medium text-ink">Featured</Badge>}
          </div>
        )}
        {save && <SaveButton {...save} size="sm" className="absolute right-2 top-2" />}
      </div>
      <div className="flex min-h-32 flex-1 flex-col p-3">
        <h3 className="line-clamp-2 min-h-8 text-small font-medium leading-tight text-ink">
          <Link
            href={listingHref(listing.slug)}
            className="after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
          >
            {listing.title}
          </Link>
        </h3>
        <p className="mt-1 truncate text-micro uppercase tracking-wide text-slate-600">{listingLocation(listing)}</p>
        {facts.length > 0 && <p className="mt-0.5 truncate text-micro text-slate-600">{facts.join(" · ")}</p>}
        <p className="tabular mt-2 flex flex-wrap items-baseline gap-x-1 text-small font-bold text-ink">
          {formatKes(listing.priceKes)}
          {listing.rentPeriod && <span className="text-micro font-normal text-slate-600">{RENT_SUFFIX[listing.rentPeriod]}</span>}
        </p>
        {listing.listerName && (
          <div className="mt-auto pt-2">
            <p className="flex items-center gap-1.5 truncate border-t border-line pt-2 text-micro text-slate-700">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-ink" />
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
    <div className="overflow-hidden rounded-sm border border-line bg-white">
      <Skeleton className="aspect-square rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="mt-1 h-4 w-1/3" />
      </div>
    </div>
  );
}

/** Placeholder grid while results stream in. */
export function PropertyGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only">Loading properties…</span>
      <div className={CARD_GRID}>
        {Array.from({ length: count }, (_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
