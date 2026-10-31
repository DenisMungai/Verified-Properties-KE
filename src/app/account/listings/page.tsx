import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Building2, Plus } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { FormAlert } from "@/components/forms/FormAlert";
import { PlanBlockLink, isPublishBlockReason } from "@/components/billing/PlanBlockLink";
import { MoreListingActions, PrimaryListingAction } from "@/components/listings/ListingActions";
import { ListingImage } from "@/components/listings/ListingImage";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { getListingPlanUsage } from "@/db/queries/billing";
import { listManageableListings, photoSummaries, type ManageableListingRow } from "@/db/queries/listings";
import type { ActionState } from "@/lib/action-state";
import { PUBLISH_BLOCK_MESSAGES, type PublishBlockReason } from "@/lib/billing/entitlements";
import { formatNairobiDate } from "@/lib/format";
import { single, type SearchParams } from "@/lib/search-params";
import { publicImageBaseUrl } from "@/lib/storage";
import { requireLister } from "./guard";

export const metadata: Metadata = { title: "My listings" };

const SUCCESS: Record<string, string> = {
  pending_review: "Submitted for review. An admin checks it before it goes live.",
  published: "Your listing is live.",
  draft: "Submission withdrawn. The listing is a draft again.",
  rented: "Marked as rented.",
  sold: "Marked as sold.",
  withdrawn: "Listing withdrawn.",
  archived: "Listing archived.",
  deleted: "Draft deleted.",
  draft_saved: "Draft saved.",
  saved: "Changes saved.",
};

const ERRORS: Record<string, string> = {
  not_found: "We couldn't find that listing.",
  not_allowed: "That change isn't available for this listing right now.",
  conflict: "That listing changed in the meantime. Please try again.",
  failed: "Something went wrong. Please try again.",
};

function bannerFor(params: Record<string, string | string[] | undefined>): ActionState | null {
  const submitted = single(params.submitted);
  const updated = single(params.updated);
  const error = single(params.error);
  if (error) {
    const message = ERRORS[error] ?? PUBLISH_BLOCK_MESSAGES[error as PublishBlockReason];
    return message ? { formError: message } : null;
  }
  const key = submitted ?? updated;
  return key && SUCCESS[key] ? { message: SUCCESS[key] } : null;
}

const location = (row: ManageableListingRow) => row.neighbourhood ?? row.town;

type ListingRow = ManageableListingRow & { coverUrl: string | null };

/** 64px cover thumbnail; decorative because the title beside it names the property. */
function Thumb({ row }: { row: ListingRow }) {
  return <ListingImage baseUrl={row.coverUrl} alt="" sizes="64px" className="w-16 shrink-0 rounded-md" />;
}

function OwnerNote({ row, userId }: { row: ListingRow; userId: string }) {
  if (row.ownerUserId === userId) return null;
  return <span className="block text-micro text-slate-600">Listed by {row.ownerName}</span>;
}

function ListingsTable({ rows, userId }: { rows: ListingRow[]; userId: string }) {
  const cell = "bg-canvas px-4 py-3 align-middle first:rounded-l-lg last:rounded-r-lg";
  return (
    <table className="hidden w-full border-separate border-spacing-y-2 text-small md:table">
      <caption className="sr-only">Your listings</caption>
      <thead>
        <tr className="text-left text-micro font-medium text-slate-600">
          <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Property</th>
          <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Location</th>
          <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Status</th>
          <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Updated</th>
          <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={`${cell} max-w-80`}>
              <div className="flex items-center gap-3">
                <Thumb row={row} />
                <div className="min-w-0">
                  <Link href={`/account/listings/${row.id}/preview`} className="font-medium text-ink hover:text-emerald-700">
                    <span className="line-clamp-2 break-words">{row.title}</span>
                  </Link>
                  <OwnerNote row={row} userId={userId} />
                  {row.status === "rejected" && row.rejectionReason && (
                    <span className="mt-1 block text-micro text-danger">Needs changes: {row.rejectionReason}</span>
                  )}
                </div>
              </div>
            </td>
            <td className={cell}>{location(row)}</td>
            <td className={cell}>
              <ListingStatusBadge status={row.status} />
            </td>
            <td className={`${cell} whitespace-nowrap text-slate-700`}>{formatNairobiDate(row.updatedAt)}</td>
            <td className={cell}>
              <div className="flex items-center gap-2">
                <PrimaryListingAction listing={row} />
                <MoreListingActions listing={row} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ListingCards({ rows, userId }: { rows: ListingRow[]; userId: string }) {
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4">
          <div className="flex items-start gap-3">
            <Thumb row={row} />
            <div className="min-w-0 flex-1">
              <Link href={`/account/listings/${row.id}/preview`} className="font-medium text-ink hover:text-emerald-700">
                <span className="break-words">{row.title}</span>
              </Link>
              <OwnerNote row={row} userId={userId} />
              <span className="block text-micro text-slate-600">
                {location(row)} · Updated {formatNairobiDate(row.updatedAt)}
              </span>
            </div>
            <ListingStatusBadge status={row.status} />
          </div>
          {row.status === "rejected" && row.rejectionReason && (
            <p className="text-micro text-danger">Needs changes: {row.rejectionReason}</p>
          )}
          <div className="flex flex-wrap items-start gap-2">
            <PrimaryListingAction listing={row} />
            <MoreListingActions listing={row} align="start" />
          </div>
        </li>
      ))}
    </ul>
  );
}

const addButton = (
  <Link href="/account/listings/new" className={buttonClasses({ size: "lg", className: "self-start" })}>
    <Plus aria-hidden="true" className="size-4" />
    Add a property
  </Link>
);

async function Listings({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireLister("/account/listings"), searchParams]);
  const db = getDb();
  const listings = await listManageableListings(db, user.id);
  const covers = await photoSummaries(
    db,
    listings.map((row) => row.id),
  );
  const rows = listings.map((row) => ({ ...row, coverUrl: publicImageBaseUrl(covers.get(row.id)?.coverKey) }));
  const banner = bannerFor(params);
  const error = single(params.error);
  const blocked = isPublishBlockReason(error) ? error : null;
  const usage = blocked ? await getListingPlanUsage(db, user.id) : null;
  return (
    <div className="flex flex-col gap-4">
      {banner && <FormAlert state={banner} />}
      {blocked && <PlanBlockLink reason={blocked} currentPlanCode={usage?.planCode ?? undefined} className="self-start" />}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="List your first property"
          description="Start with the basics. Drafts are saved as you go and are free; you need a listing plan to publish."
          action={addButton}
        />
      ) : (
        <section aria-labelledby="your-listings-heading" className="rounded-lg border border-line bg-white p-4 md:p-5">
          <h2 id="your-listings-heading" className="mb-2 text-title">
            Your listings
          </h2>
          <ListingsTable rows={rows} userId={user.id} />
          <ListingCards rows={rows} userId={user.id} />
        </section>
      )}
    </div>
  );
}

function ListingsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-5" aria-busy="true">
      <span className="sr-only">Loading your listings</span>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default function MyListingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="My listings" description="Create, submit and manage your property listings." action={addButton} />
      <Suspense fallback={<ListingsSkeleton />}>
        <Listings searchParams={searchParams} />
      </Suspense>
    </>
  );
}
