import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClipboardCheck } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { FormAlert } from "@/components/forms/FormAlert";
import { EmptyState, Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { moderationQueue } from "@/db/queries/moderation";
import { formatNairobiDateTime } from "@/lib/format";
import { single, type SearchParams } from "@/lib/search-params";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Listings awaiting moderation", robots: { index: false } };

const NOTICES: Record<string, string> = {
  approved: "Listing approved. It's live in search.",
  rejected: "Listing rejected. The lister can see your reason.",
};

/** Design "Listings awaiting moderation" (prompt S8 decision 12). Platform admins only. */
async function Queue({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["platform_admin"], "/admin/listings");
  const [params, rows] = await Promise.all([searchParams, moderationQueue(getDb())]);
  const notice = NOTICES[single(params.notice) ?? ""];
  return (
    <div className="flex flex-col gap-4">
      {notice && <FormAlert state={{ message: notice }} />}
      {rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title="Nothing to review" description="New and edited listings from unverified listers appear here." />
      ) : (
        <div className="rounded-lg border border-line bg-white p-2 md:p-4">
          <table className="w-full border-separate border-spacing-y-2 text-left text-small">
            <caption className="sr-only">Listings awaiting moderation, oldest first</caption>
            <thead className="hidden text-micro text-slate-600 md:table-header-group">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide">Listing</th>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide">Lister</th>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide">Submitted</th>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide">Reason</th>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="flex flex-col rounded-lg bg-canvas p-3 md:table-row md:p-0">
                  <td className="px-1 font-medium text-ink md:rounded-l-lg md:px-4 md:py-3">{row.title}</td>
                  <td className="px-1 text-slate-700 md:px-4 md:py-3">{row.listerName}</td>
                  <td className="px-1 text-slate-700 md:px-4 md:py-3">{formatNairobiDateTime(row.submittedAt)}</td>
                  <td className="px-1 text-slate-700 md:px-4 md:py-3">{row.everPublished ? "Edited after publishing" : "New listing"}</td>
                  <td className="md:rounded-r-lg md:px-4 md:py-1">
                    <Link
                      href={`/admin/listings/${row.id}`}
                      className="inline-flex min-h-control items-center px-1 font-semibold text-emerald-700 hover:underline"
                    >
                      Review<span className="sr-only"> {row.title}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ModerationQueuePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="Listings awaiting moderation" description="Approve or reject listings from unverified listers. Oldest first." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
