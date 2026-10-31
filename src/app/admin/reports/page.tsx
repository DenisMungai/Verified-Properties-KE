import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Flag } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { DismissReportForm, TakeDownForm } from "@/components/admin/DecisionForms";
import { FormAlert } from "@/components/forms/FormAlert";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { listingHref } from "@/components/search/PropertyCard";
import { EmptyState, Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { listOpenReports, type OpenReport } from "@/db/queries/reports";
import { formatNairobiDateTime } from "@/lib/format";
import { single, type SearchParams } from "@/lib/search-params";
import { requireRole } from "@/lib/session";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/validation/engagement";

export const metadata: Metadata = { title: "Reported listings", robots: { index: false } };

const NOTICES: Record<string, string> = {
  dismissed: "Report dismissed.",
  taken_down: "Listing taken down. The lister can see your reason, and its open reports are resolved.",
};

function reasonLabel(reason: string): string {
  return REPORT_REASON_LABELS[reason as ReportReason] ?? reason;
}

function ReportItem({ report }: { report: OpenReport }) {
  return (
    <li className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body font-semibold text-ink">
            {report.propertyStatus === "published" ? (
              <Link href={listingHref(report.propertySlug)} className="text-emerald-700 underline underline-offset-4">
                {report.propertyTitle}
              </Link>
            ) : (
              <Link href={`/admin/listings/${report.propertyId}`} className="text-emerald-700 underline underline-offset-4">
                {report.propertyTitle}
              </Link>
            )}
          </p>
          <p className="text-micro text-slate-600">
            {reasonLabel(report.reason)} · reported {formatNairobiDateTime(report.createdAt)}
            {report.reporterName ? ` by ${report.reporterName}` : ""}
          </p>
        </div>
        <ListingStatusBadge status={report.propertyStatus} />
      </div>
      {report.details && <p className="whitespace-pre-line break-words text-small text-slate-700">{report.details}</p>}
      <div className="grid gap-5 border-t border-line pt-4 md:grid-cols-[auto_minmax(0,1fr)] md:gap-8">
        <DismissReportForm reportId={report.id} />
        <TakeDownForm reportId={report.id} />
      </div>
    </li>
  );
}

/** Open reports, newest first (prompt S8 decisions 4 and 12). Platform admins only. */
async function Reports({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["platform_admin"], "/admin/reports");
  const [params, reports] = await Promise.all([searchParams, listOpenReports(getDb())]);
  const notice = NOTICES[single(params.notice) ?? ""];
  return (
    <div className="flex flex-col gap-4">
      {notice && <FormAlert state={{ message: notice }} />}
      {reports.length === 0 ? (
        <EmptyState icon={<Flag />} title="No open reports" description="Reports from buyers and tenants appear here." />
      ) : (
        <ul className="flex flex-col gap-4">
          {reports.map((report) => (
            <ReportItem key={report.id} report={report} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="Reported listings" description="Dismiss a report, or take the listing down with a reason the lister sees." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </>
  );
}
