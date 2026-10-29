import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DetailsForm } from "@/components/listings/DetailsForm";
import { ListingEditorLayout, ListingEditorSkeleton } from "@/components/listings/ListingEditorLayout";
import { PlanUsagePanel } from "@/components/listings/PlanUsagePanel";
import { isEditableByLister } from "@/lib/listings/workflow";
import { detailsDefaults, editorHeading, loadEditableListing } from "../../editor-data";

export const metadata: Metadata = { title: "Listing details" };

async function EditDetails({ params }: { params: Promise<{ id: string }> }) {
  const { listing, usage } = await loadEditableListing(params, "details");
  if (!isEditableByLister(listing.status)) redirect(`/account/listings/${listing.id}/preview`);
  return (
    <ListingEditorLayout
      {...editorHeading(listing)}
      listingId={listing.id}
      step="details"
      aside={<PlanUsagePanel usage={usage} />}
    >
      {/* Keyed by category so a category change in Basics remounts the conditional fields. */}
      <DetailsForm
        key={listing.category}
        listingId={listing.id}
        category={listing.category}
        defaults={detailsDefaults(listing)}
      />
    </ListingEditorLayout>
  );
}

export default function ListingDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ListingEditorSkeleton />}>
      <EditDetails params={params} />
    </Suspense>
  );
}
