import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FormAlert } from "@/components/forms/FormAlert";
import { BasicsForm } from "@/components/listings/BasicsForm";
import { ListingEditorLayout, ListingEditorSkeleton } from "@/components/listings/ListingEditorLayout";
import { PlanUsagePanel } from "@/components/listings/PlanUsagePanel";
import { isEditableByLister } from "@/lib/listings/workflow";
import type { SearchParams } from "@/lib/search-params";
import { basicsDefaults, editorHeading, loadEditableListing } from "../../editor-data";

export const metadata: Metadata = { title: "Listing basics" };

async function EditBasics({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ listing, usage }, query] = await Promise.all([loadEditableListing(params, "basics"), searchParams]);
  if (!isEditableByLister(listing.status)) redirect(`/account/listings/${listing.id}/preview`);
  return (
    <ListingEditorLayout
      {...editorHeading(listing)}
      listingId={listing.id}
      step="basics"
      aside={<PlanUsagePanel usage={usage} />}
      notice={query.saved === "1" ? <FormAlert state={{ message: "Draft saved." }} /> : undefined}
    >
      <BasicsForm listingId={listing.id} defaults={basicsDefaults(listing)} />
    </ListingEditorLayout>
  );
}

export default function ListingBasicsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<ListingEditorSkeleton />}>
      <EditBasics params={params} searchParams={searchParams} />
    </Suspense>
  );
}
