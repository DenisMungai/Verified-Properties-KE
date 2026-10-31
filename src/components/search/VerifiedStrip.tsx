import { CARD_GRID, PropertyCard, type PropertyCardData } from "./PropertyCard";
import type { SaveButtonProps } from "@/components/listing/SaveButton";

/**
 * Up to three matching verified listings above Newest and Price results (prompt S7 decision 7).
 * Labelled as paid placement; the same listings also keep their strict place in the results.
 */
export function VerifiedStrip({
  listings,
  saveFor,
}: {
  listings: PropertyCardData[];
  saveFor: (listingId: string) => SaveButtonProps;
}) {
  if (listings.length === 0) return null;
  return (
    <section aria-labelledby="verified-strip-heading" className="flex flex-col gap-3 rounded-lg bg-mint-50 p-3 sm:p-4">
      <div className="flex flex-col gap-1">
        <h2 id="verified-strip-heading" className="text-title">
          Verified listers
        </h2>
        <p className="text-small text-slate-700">
          Paid placement for verified listers that match your search. They also appear in their usual place below.
        </p>
      </div>
      <ul className={CARD_GRID}>
        {listings.map((listing) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} save={saveFor(listing.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
