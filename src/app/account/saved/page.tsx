import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Heart } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Saved properties" };

/** Favourites arrive with listings (S8). Until then the shortlist is honestly empty. */
async function SavedList() {
  await requireUser("/account/saved");
  return (
    <>
      {/* Design shows "Recently viewed" and "Search alerts" tabs too; they are added when built. */}
      <div className="mb-6 flex rounded-lg border border-line bg-white p-1">
        <p className="inline-flex min-h-control items-center rounded-md bg-mint-50 px-4 text-body font-medium text-emerald-700">
          All saved (0)
        </p>
      </div>
      <EmptyState
        icon={<Heart />}
        title="No saved properties yet"
        description="Tap the heart on any listing to keep it here."
        action={
          <Link href="/" className={buttonClasses()}>
            Explore properties
          </Link>
        }
      />
    </>
  );
}

export default function SavedPage() {
  return (
    <>
      <PageHeading title="Saved properties" description="Your shortlist, all in one place." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <SavedList />
      </Suspense>
    </>
  );
}
