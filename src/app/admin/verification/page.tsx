import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BadgeCheck } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { FormAlert } from "@/components/forms/FormAlert";
import { Badge, EmptyState, Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { verificationQueue, type QueueTab } from "@/db/queries/verification";
import { formatNairobiDate, formatNairobiDateTime } from "@/lib/format";
import { LISTER_TYPE_LABELS } from "@/lib/roles";
import { single, type SearchParams } from "@/lib/search-params";
import { requireRole } from "@/lib/session";
import { REVIEW_TARGET_WORKING_DAYS, requestNumber, workingDaysBetween } from "@/lib/verification/rules";

export const metadata: Metadata = { title: "Verification reviews", robots: { index: false } };

const TABS: { tab: QueueTab; label: string }[] = [
  { tab: "under_review", label: "To review" },
  { tab: "documents_pending", label: "Waiting on lister" },
  { tab: "verified", label: "Verified" },
  { tab: "expired", label: "Expired" },
  { tab: "rejected", label: "Rejected" },
  { tab: "suspended", label: "Suspended" },
];

const NOTICES: Record<string, string> = {
  approved: "Verification approved. The lister's badge shows while both their plans are paid.",
  changes_requested: "Changes requested. The lister can see your reason and upload again.",
  rejected: "Verification rejected. The fee was credited to the lister's listing plan.",
  rejected_refund: "Verification rejected. The fee couldn't be credited, so the lister needs a manual refund.",
  rejected_rereview: "Re-review rejected. Nothing was paid for it, so there's no credit; the lister's current review stays valid until it ends.",
  suspended: "Badge suspended. It's hidden from search and the lister's listings straight away.",
};

function isTab(value: string | undefined): value is QueueTab {
  return TABS.some((t) => t.tab === value);
}

/** Verification queue (prompt S12 decision 8). Platform admins only; oldest submitted first. */
async function Queue({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["platform_admin"], "/admin/verification");
  const params = await searchParams;
  const requested = single(params.tab);
  const tab: QueueTab = isTab(requested) ? requested : "under_review";
  const rows = await verificationQueue(getDb(), tab);
  const notice = NOTICES[single(params.notice) ?? ""];
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {notice && <FormAlert state={{ message: notice }} />}
      <nav aria-label="Verification status">
        <ul className="hide-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {TABS.map((t) => (
            <li key={t.tab} className="shrink-0">
              <Link
                href={t.tab === "under_review" ? "/admin/verification" : `/admin/verification?tab=${t.tab}`}
                aria-current={t.tab === tab ? "page" : undefined}
                className={
                  t.tab === tab
                    ? "flex min-h-control items-center rounded-full bg-mint-50 px-4 text-small font-semibold text-emerald-700"
                    : "flex min-h-control items-center rounded-full px-4 text-small font-medium text-slate-600 hover:bg-white hover:text-ink"
                }
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck />}
          title={tab === "under_review" ? "Nothing to review" : "Nothing here"}
          description={tab === "under_review" ? "Listers who have paid and submitted their documents appear here." : "No requests have this status."}
        />
      ) : (
        <div className="rounded-lg border border-line bg-white p-2 md:p-4">
          <table className="w-full border-separate border-spacing-y-2 text-left text-small">
            <caption className="sr-only">Verification requests: {TABS.find((t) => t.tab === tab)?.label}</caption>
            <thead className="hidden text-micro text-slate-600 md:table-header-group">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide">Lister</th>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide">Request</th>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide">{tab === "under_review" ? "Submitted" : "Updated"}</th>
                <th scope="col" className="px-4 py-2 font-semibold uppercase tracking-wide"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const age = row.submittedAt ? workingDaysBetween(row.submittedAt, now) : 0;
                const late = tab === "under_review" && age >= REVIEW_TARGET_WORKING_DAYS;
                return (
                  <tr key={row.id} className="flex flex-col rounded-lg bg-canvas p-3 md:table-row md:p-0">
                    <td className="px-1 md:rounded-l-lg md:px-4 md:py-3">
                      <span className="block font-medium text-ink">{row.listerName}</span>
                      <span className="text-micro text-slate-600">
                        {LISTER_TYPE_LABELS[row.listerType]}
                        {row.agencyName ? ` · ${row.agencyName}` : ""}
                      </span>
                    </td>
                    <td className="px-1 text-slate-700 md:px-4 md:py-3">
                      {requestNumber(row.id)}
                      {row.renewsRequestId && <span className="block text-micro text-slate-600">Re-review</span>}
                    </td>
                    <td className="px-1 text-slate-700 md:px-4 md:py-3">
                      {tab === "under_review" && row.submittedAt ? (
                        <span className="flex flex-wrap items-center gap-2">
                          {formatNairobiDateTime(row.submittedAt)}
                          {late && <Badge tone="warning">Over {REVIEW_TARGET_WORKING_DAYS} working days</Badge>}
                        </span>
                      ) : (
                        formatNairobiDate(row.updatedAt)
                      )}
                    </td>
                    <td className="md:rounded-r-lg md:px-4 md:py-1">
                      <Link
                        href={`/admin/verification/${row.id}`}
                        className="inline-flex min-h-control items-center px-1 font-semibold text-emerald-700 hover:underline"
                      >
                        {tab === "under_review" ? "Review" : "Open"}
                        <span className="sr-only"> {row.listerName}</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function VerificationQueuePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="Verification reviews" description="Check documents and approve only when the requirements are met. Aim for 2 working days." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
