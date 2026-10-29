import type { Metadata } from "next";
import { Suspense } from "react";
import { ListingEditorLayout, ListingEditorSkeleton } from "@/components/listings/ListingEditorLayout";
import { PhotoManager } from "@/components/listings/PhotoManager";
import { PHOTO_TIPS, PlanUsagePanel } from "@/components/listings/PlanUsagePanel";
import { getDb } from "@/db";
import { isListerVerified } from "@/db/queries/billing";
import { listPhotos } from "@/db/queries/listing-photos";
import type { EditableListing } from "@/db/queries/listings";
import { isEditableByLister } from "@/lib/listings/workflow";
import { publicImageBaseUrl } from "@/lib/storage";
import { editorHeading, loadEditableListing } from "../../editor-data";

export const metadata: Metadata = { title: "Listing photos" };

/** What adding a photo does to this listing's status (prompt S4 decision 6), or null. */
async function reviewWarning(listing: EditableListing): Promise<string | null> {
  if (listing.status !== "published" && listing.status !== "paused") return null;
  if (await isListerVerified(getDb(), listing.ownerUserId)) return null;
  return listing.status === "published"
    ? "Adding photos sends a live listing back to review."
    : "Adding photos turns this paused listing into a draft you'll need to submit again.";
}

async function EditPhotos({ params }: { params: Promise<{ id: string }> }) {
  const { user, listing, usage } = await loadEditableListing(params, "photos");
  const [photos, warning] = await Promise.all([listPhotos(getDb(), user.id, listing.id), reviewWarning(listing)]);
  return (
    <ListingEditorLayout
      {...editorHeading(listing)}
      listingId={listing.id}
      step="photos"
      aside={<PlanUsagePanel usage={usage} tips={PHOTO_TIPS} />}
    >
      <PhotoManager
        listingId={listing.id}
        photos={(photos ?? []).map((photo) => ({
          id: photo.id,
          baseUrl: publicImageBaseUrl(photo.storageKey),
          altText: photo.altText,
          isCover: photo.isCover,
        }))}
        editable={isEditableByLister(listing.status)}
        reviewWarning={warning}
        continueHref={`/account/listings/${listing.id}/preview`}
        saveHref={`/account/listings?updated=${listing.status === "draft" ? "draft_saved" : "saved"}`}
      />
    </ListingEditorLayout>
  );
}

export default function ListingPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ListingEditorSkeleton />}>
      <EditPhotos params={params} />
    </Suspense>
  );
}
