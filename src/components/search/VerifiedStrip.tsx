import { PropertyCard, type PropertyCardData } from "./PropertyCard";

/**
 * Up to three matching verified listings above Newest and Price results (prompt S7 decision 7).
 * Labelled as paid placement; the same listings also keep their strict place in the results.
 */
export function VerifiedStrip({ listings }: { listings: PropertyCardData[] }) {
  if (listings.length === 0) return null;
  return (
    <section aria-labelledby="verified-strip-heading" className="flex flex-col gap-4 rounded-xl bg-mint-50 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="verified-strip-heading" className="text-h4">
          Verified listers
        </h2>
        <p className="text-body-sm text-slate-700">
          Paid placement for verified listers that match your search. They also appear in their usual place below.
        </p>
      </div>
      <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {listings.map((listing) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} />
          </li>
        ))}
      </ul>
    </section>
  );
}
