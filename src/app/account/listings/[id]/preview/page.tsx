import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CircleAlert } from "lucide-react";
import { ListingEditorLayout, ListingEditorSkeleton } from "@/components/listings/ListingEditorLayout";
import { MoreListingActions, PrimaryListingAction } from "@/components/listings/ListingActions";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { ListingSummary } from "@/components/listings/ListingSummary";
import { PlanUsagePanel } from "@/components/listings/PlanUsagePanel";
import { SubmitListingForm } from "@/components/listings/SubmitListingForm";
import { getDb } from "@/db";
import { getPublishEntitlement, isListerVerified } from "@/db/queries/billing";
import { listPhotos } from "@/db/queries/listing-photos";
import { listingFieldsOf, type EditableListing } from "@/db/queries/listings";
import { PUBLISH_BLOCK_MESSAGES, type PublishEntitlement } from "@/lib/billing/entitlements";
import { canSubmit } from "@/lib/listings/workflow";
import { publicImageBaseUrl } from "@/lib/storage";
import { CHECKLIST_LABELS, parseSubmission, stepForField } from "@/lib/validation/listing";
import { editorHeading, loadEditableListing } from "../../editor-data";

export const metadata: Metadata = { title: "Preview listing" };

const PAUSE_REASONS: Record<string, string> = {
  plan_lapsed: "Your listing plan lapsed, so this listing was paused and left search.",
  over_plan_limit: "This listing was paused because you were over your plan's limit.",
};

const STATUS_NOTES: Partial<Record<EditableListing["status"], string>> = {
  pending_review: "An admin checks listings from unverified listers before they go live. You'll see the result here.",
  published:
    "This listing is live. Changing the title, description, type or location, or adding photos, sends it back to review unless you're verified.",
  rented: "Marked as rented. It no longer appears in search.",
  sold: "Marked as sold. It no longer appears in search.",
  withdrawn: "Withdrawn. It no longer appears in search.",
  archived: "Archived for your records.",
};

function MissingChecklist({ listingId, errors }: { listingId: string; errors: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-body-sm font-semibold text-ink">Before you submit</h3>
      <ul className="flex flex-col gap-2">
        {Object.entries(errors).map(([field, message]) => (
          <li key={field} className="flex items-start gap-2 text-body-sm">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-text" />
            <span>
              <Link
                href={`/account/listings/${listingId}/${stepForField(field)}#${field}`}
                className="font-medium text-emerald-700 underline underline-offset-2 hover:text-ink"
              >
                {CHECKLIST_LABELS[field] ?? field}
              </Link>
              <span className="text-slate-700">: {message}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubmitPanel({
  listing,
  errors,
  entitlement,
  verified,
}: {
  listing: EditableListing;
  errors: Record<string, string> | null;
  entitlement: PublishEntitlement;
  verified: boolean;
}) {
  const submittable = canSubmit(listing.status);
  return (
    <section aria-labelledby="submit-heading" className="flex flex-col gap-4 rounded-xl border border-line bg-white p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="submit-heading" className="text-h4">
          {submittable ? (verified ? "Ready to publish?" : "Ready to submit?") : "Listing status"}
        </h2>
        <ListingStatusBadge status={listing.status} />
      </div>

      {listing.status === "rejected" && listing.rejectionReason && (
        <p className="rounded-md bg-danger-tint px-4 py-3 text-body-sm text-danger">
          <span className="font-semibold">Needs changes: </span>
          {listing.rejectionReason}
        </p>
      )}
      {listing.status === "paused" && (
        <p className="text-body-sm text-slate-700">
          {PAUSE_REASONS[listing.pauseReason ?? ""] ?? "This listing is paused and not in search."} Un-pause it once your
          plan has room.
        </p>
      )}
      {!submittable && STATUS_NOTES[listing.status] && (
        <p className="text-body-sm text-slate-700">{STATUS_NOTES[listing.status]}</p>
      )}

      {submittable && errors && <MissingChecklist listingId={listing.id} errors={errors} />}
      {submittable && !errors && !entitlement.ok && (
        <div className="flex flex-col gap-1 rounded-md bg-warning-tint px-4 py-3 text-body-sm text-warning-text">
          <p className="font-semibold">{PUBLISH_BLOCK_MESSAGES[entitlement.reason]}</p>
          {/* The billing page arrives in S6. */}
          <p>Listing plans open soon. Your draft is saved in the meantime.</p>
        </div>
      )}
      {submittable && !errors && entitlement.ok && (
        <p className="text-body-sm text-slate-700">
          {verified
            ? "You're a verified lister, so the listing goes live as soon as you publish."
            : "An admin checks it before it goes live. It uses one of your plan's listing slots while in review."}
        </p>
      )}
      {submittable && (
        <SubmitListingForm
          listingId={listing.id}
          label={verified ? "Publish listing" : "Submit for review"}
          disabled={Boolean(errors) || !entitlement.ok}
        />
      )}

      <div className="flex flex-wrap items-start gap-2 border-t border-line pt-4">
        {!submittable && <PrimaryListingAction listing={listing} />}
        <MoreListingActions listing={listing} align="start" />
      </div>
    </section>
  );
}

async function Preview({ params }: { params: Promise<{ id: string }> }) {
  const { user, listing, usage } = await loadEditableListing(params, "preview");
  const db = getDb();
  const [entitlement, verified, photos] = await Promise.all([
    getPublishEntitlement(db, listing.ownerUserId),
    isListerVerified(db, listing.ownerUserId),
    listPhotos(db, user.id, listing.id).then((rows) => rows ?? []),
  ]);
  const parsed = parseSubmission(listingFieldsOf(listing), {
    count: photos.length,
    hasCover: photos.some((photo) => photo.isCover),
  });
  // Cover first, then the rest in the lister's order.
  const ordered = [...photos].sort((a, b) => Number(b.isCover) - Number(a.isCover));

  return (
    <ListingEditorLayout
      {...editorHeading(listing)}
      listingId={listing.id}
      step="preview"
      aside={
        <div className="flex flex-col gap-6">
          <SubmitPanel
            listing={listing}
            errors={parsed.success ? null : parsed.errors}
            entitlement={entitlement}
            verified={verified}
          />
          <PlanUsagePanel usage={usage} />
        </div>
      }
    >
      <p className="mb-6 text-caption text-slate-600">How buyers and tenants will see your listing.</p>
      <ListingSummary
        listing={listing}
        photos={ordered.map((photo) => ({ baseUrl: publicImageBaseUrl(photo.storageKey), altText: photo.altText }))}
      />
    </ListingEditorLayout>
  );
}

export default function ListingPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ListingEditorSkeleton />}>
      <Preview params={params} />
    </Suspense>
  );
}
