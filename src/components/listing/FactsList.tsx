import { Check } from "lucide-react";
import { listingFacts } from "@/components/listings/ListingSummary";
import type { PublicListingDetail } from "@/db/queries/listing-detail";
import { CATEGORY_LABELS } from "@/lib/validation/listing";

const eyebrow = "text-micro tracking-wide font-semibold uppercase text-slate-600";

/** "Property details" chips and the amenities list (design "03 — Property Detail"). */
export function FactsList({ listing }: { listing: PublicListingDetail }) {
  const home = listing.category === "house" || listing.category === "apartment";
  const facts = [
    CATEGORY_LABELS[listing.category],
    ...listingFacts(listing),
    ...(home && !listing.furnished ? ["Unfurnished"] : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="facts-heading" className="flex flex-col gap-3">
        <h2 id="facts-heading" className={eyebrow}>
          Property details
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {facts.map((fact) => (
            <li key={fact} className="rounded-md border border-line bg-white px-3 py-2.5 text-small text-ink">
              {fact}
            </li>
          ))}
        </ul>
        {listing.zoningNotes && (
          <p className="text-small text-slate-700">
            <span className="font-medium text-ink">Permitted use: </span>
            {listing.zoningNotes}
          </p>
        )}
      </section>
      {listing.amenities.length > 0 && (
        <section aria-labelledby="amenities-heading" className="flex flex-col gap-3">
          <h2 id="amenities-heading" className="text-title">
            Amenities
          </h2>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {listing.amenities.map((amenity) => (
              <li key={amenity} className="flex items-center gap-1.5 text-small text-slate-700">
                <Check aria-hidden="true" className="size-4 text-emerald-600" />
                {amenity}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
