import { MapPin } from "lucide-react";
import type { EditableListing } from "@/db/queries/listings";
import { ListingImage } from "./ListingImage";
import { formatAreaSqm, formatKes, formatLandSize } from "@/lib/format";
import { CATEGORY_LABELS, LISTING_TYPE_LABELS } from "@/lib/validation/listing";

const RENT_SUFFIX = { week: "/ week", month: "/ month", year: "/ year" } as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Key facts as short labels, with units always written out (plan §14). */
export function listingFacts(
  listing: Pick<
    EditableListing,
    "bedrooms" | "bathrooms" | "areaSqm" | "landSize" | "landSizeUnit" | "subtype" | "furnished" | "parkingSpaces"
  >,
): string[] {
  const facts: string[] = [];
  if (listing.bedrooms !== null) facts.push(listing.bedrooms === 0 ? "Studio" : plural(listing.bedrooms, "bedroom"));
  if (listing.bathrooms !== null) facts.push(plural(listing.bathrooms, "bathroom"));
  if (listing.areaSqm !== null) facts.push(formatAreaSqm(listing.areaSqm));
  if (listing.landSize !== null && listing.landSizeUnit) facts.push(formatLandSize(listing.landSize, listing.landSizeUnit));
  if (listing.subtype) facts.push(listing.subtype);
  if (listing.furnished) facts.push("Furnished");
  if (listing.parkingSpaces) facts.push(plural(listing.parkingSpaces, "parking space"));
  return facts;
}

/** "Kilimani, Nairobi" rather than "Kilimani, Nairobi, Nairobi" when town and county share a name. */
export function listingLocation(listing: Pick<EditableListing, "neighbourhood" | "town" | "county">): string {
  const parts = [listing.neighbourhood, listing.town, listing.county].filter((part): part is string => Boolean(part));
  return parts.filter((part, i) => i === 0 || part.toLowerCase() !== parts[i - 1].toLowerCase()).join(", ");
}

const STRIP_SIZE = 5;

/** Cover photo, then a strip of up to five more with "+n more" (or the fallback panel). */
function PhotoPreview({ photos }: { photos: { baseUrl: string | null; altText: string }[] }) {
  const [cover, ...rest] = photos;
  if (!cover) return <ListingImage baseUrl={null} alt="No photos yet" sizes="100vw" className="rounded-lg" />;
  const strip = rest.slice(0, STRIP_SIZE);
  const more = rest.length - strip.length;
  return (
    <div className="flex flex-col gap-2">
      <ListingImage
        baseUrl={cover.baseUrl}
        alt={cover.altText}
        sizes="(min-width: 1024px) 720px, 100vw"
        preload
        className="rounded-lg"
      />
      {strip.length > 0 && (
        <ul aria-label="More photos" className="grid grid-cols-5 gap-2">
          {strip.map((photo, index) => (
            <li key={index}>
              <ListingImage baseUrl={photo.baseUrl} alt={photo.altText} sizes="144px" className="rounded-md" />
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="text-caption text-slate-600">+{more} more</p>}
    </div>
  );
}

/** "How buyers will see it" summary on the Preview step. Text only, never rendered as HTML. */
export function ListingSummary({
  listing,
  photos,
}: {
  listing: EditableListing;
  photos: { baseUrl: string | null; altText: string }[];
}) {
  const facts = listingFacts(listing);
  const paragraphs = listing.description.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <article aria-labelledby="summary-title" className="flex flex-col gap-5">
      <PhotoPreview photos={photos} />
      <p className="text-label uppercase text-slate-600">
        {LISTING_TYPE_LABELS[listing.listingType]} · {CATEGORY_LABELS[listing.category]}
      </p>
      <div className="flex flex-col gap-2">
        <h2 id="summary-title" className="text-h2 break-words">
          {listing.title}
        </h2>
        <p className="text-price text-emerald-700">
          {formatKes(listing.priceKes)}
          {listing.rentPeriod && <span className="text-body font-normal text-slate-600"> {RENT_SUFFIX[listing.rentPeriod]}</span>}
        </p>
        <p className="flex items-start gap-2 text-body-sm text-slate-700">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {listingLocation(listing)}
        </p>
      </div>
      {facts.length > 0 && (
        <ul aria-label="Key facts" className="flex flex-wrap gap-2">
          {facts.map((fact) => (
            <li key={fact} className="rounded-pill border border-line bg-white px-3 py-1 text-body-sm text-ink">
              {fact}
            </li>
          ))}
        </ul>
      )}
      {paragraphs.length > 0 ? (
        <div className="flex flex-col gap-3 text-body text-ink">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="whitespace-pre-line break-words">
              {paragraph}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-body-sm text-slate-600">No description yet.</p>
      )}
      {listing.amenities.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-body-sm font-semibold text-ink">Amenities</h3>
          <p className="text-body-sm text-slate-700">{listing.amenities.join(" · ")}</p>
        </div>
      )}
    </article>
  );
}
