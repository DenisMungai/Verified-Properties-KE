import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Heart } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { CARD_GRID, PropertyCard, PropertyGridSkeleton } from "@/components/search/PropertyCard";
import { toCardData } from "@/components/search/card-data";
import { EmptyState, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { savedListings } from "@/db/queries/public-listings";
import { SEARCH_PATH } from "@/lib/search/params";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Saved properties", robots: { index: false } };

/**
 * Design "05 — Saved Properties" (prompt S8 decision 6). Lists saved listings that are still
 * published; a paused or sold one drops out and returns if it goes live again.
 */
async function SavedList() {
  const user = await requireUser("/account/saved");
  await connection();
  const saved = toCardData(await savedListings(getDb(), user.id));
  return (
    <>
      {/* Design shows "Recently viewed" and "Search alerts" tabs too; they are added when built. */}
      <div className="mb-6 flex rounded-lg border border-line bg-white p-1">
        <p className="inline-flex min-h-control items-center rounded-md bg-mint-50 px-4 text-body font-medium text-emerald-700">
          All saved ({saved.length})
        </p>
      </div>
      {saved.length === 0 ? (
        <EmptyState
          icon={<Heart />}
          title="No saved properties yet"
          description="Tap the heart on any listing to keep it here."
          action={
            <Link href={SEARCH_PATH} className={buttonClasses()}>
              Explore properties
            </Link>
          }
        />
      ) : (
        <ul className={CARD_GRID}>
          {saved.map((listing) => (
            <li key={listing.id} className="flex">
              <PropertyCard listing={listing} save={{ listingId: listing.id, saved: true, refreshAfter: true }} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function SavedPage() {
  return (
    <>
      <PageHeading title="Saved properties" description="Your shortlist, all in one place." />
      <Suspense fallback={<PropertyGridSkeleton count={3} />}>
        <SavedList />
      </Suspense>
    </>
  );
}
