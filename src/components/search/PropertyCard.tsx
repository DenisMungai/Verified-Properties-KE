import Link from "next/link";
import { ListingImage } from "@/components/listings/ListingImage";
import { listingLocation } from "@/components/listings/ListingSummary";
import { SaveButton, type SaveButtonProps } from "@/components/listing/SaveButton";
import { Avatar, Badge, Skeleton, VerifiedBadge } from "@/components/ui";
import type { PublicListingCard } from "@/db/queries/public-listings";
import { formatKes } from "@/lib/format";
import { RENT_SUFFIX, cardFacts, cardImageAlt } from "@/lib/search/card";

/** A public card with its images resolved to URLs. Storage keys never reach the browser. */
export type PropertyCardData = Omit<PublicListingCard, "coverKey" | "listerAvatarKey"> & {
  coverUrl: string | null;
  listerAvatarUrl: string | null;
};

/** `sizes` for the 1 / 2 / 3-column card grids inside the 1440px shell. */
export const CARD_IMAGE_SIZES = "(min-width: 1280px) 440px, (min-width: 640px) 50vw, 100vw";

/** The design's card grid: one column on phones, 2 from sm, 3 from xl. */
export const CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3";

/** Home listings: 1 / 2 / 4 columns, no 3-column step, so `HOME_SLOTS` rows always fill. */
export const HOME_CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4";

/** `sizes` for `HOME_CARD_GRID` inside the 1440px shell. */
export const HOME_CARD_IMAGE_SIZES = "(min-width: 1280px) 340px, (min-width: 640px) 50vw, 100vw";

/** The design's white chip over the photo. */
const PHOTO_CHIP = "rounded bg-white px-2.5 py-1 uppercase tracking-wide";

export function listingHref(slug: string): string {
  return `/properties/${slug}`;
}

/**
 * Design "Property card - reusable" (prompt ui-design-cards-detail): wide photo with the verified
 * chip top-left and the heart top-right, then price first, title, location, facts and the lister.
 * The title link is stretched over the whole card; the heart sits above it so both stay usable.
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
    <article className="relative flex w-full flex-col overflow-hidden rounded-xl border border-line bg-white transition-shadow duration-200 hover:shadow-sm has-[h3_a:focus-visible]:outline has-[h3_a:focus-visible]:outline-2 has-[h3_a:focus-visible]:outline-offset-2 has-[h3_a:focus-visible]:outline-emerald-600">
      <div className="relative">
        <ListingImage baseUrl={listing.coverUrl} alt={cardImageAlt(listing)} sizes={sizes} className="aspect-video" />
        {(listing.verified || featured) && (
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            {listing.verified && <VerifiedBadge className={`${PHOTO_CHIP} text-emerald-700`} />}
            {featured && <Badge className={`${PHOTO_CHIP} text-ink`}>Featured</Badge>}
          </div>
        )}
        {save && <SaveButton {...save} size="sm" className="absolute right-3 top-3" />}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="tabular text-title font-bold text-ink">
          {formatKes(listing.priceKes)}
          {listing.rentPeriod && <span> {RENT_SUFFIX[listing.rentPeriod]}</span>}
        </p>
        <h3 className="mt-1 line-clamp-2 text-small font-medium text-ink">
          <Link
            href={listingHref(listing.slug)}
            className="after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
          >
            {listing.title}
          </Link>
        </h3>
        <p className="mt-1 truncate text-small text-slate-600">{listingLocation(listing)}</p>
        {facts.length > 0 && <p className="mt-2 truncate text-micro text-slate-600">{facts.join(" · ")}</p>}
        {listing.listerName && (
          <div className="mt-auto pt-3">
            <p className="flex items-center gap-2 border-t border-line pt-3 text-micro text-slate-700">
              <Avatar name={listing.listerName} baseUrl={listing.listerAvatarUrl} size="xs" />
              <span className="truncate">
                <span className="sr-only">Listed by </span>
                {listing.listerName}
              </span>
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

export function PropertyCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <Skeleton className="aspect-video rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="mt-1 h-3 w-1/3" />
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-3">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

/** Placeholder grid while results stream in. */
export function PropertyGridSkeleton({
  count = 6,
  grid = CARD_GRID,
  className,
}: {
  count?: number;
  grid?: string;
  className?: string;
}) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only">Loading properties…</span>
      <div className={grid}>
        {Array.from({ length: count }, (_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
