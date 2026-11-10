import Link from "next/link";
import { Suspense } from "react";
import { Flag, MessageSquareWarning } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { AdminGate } from "@/components/admin/AdminGate";
import { DismissReportForm, TakeDownForm } from "@/components/admin/DecisionForms";
import { FormAlert } from "@/components/forms/FormAlert";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { listingHref } from "@/components/search/PropertyCard";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { listOpenMessageReports, type OpenMessageReport } from "@/db/queries/message-moderation";
import { listOpenReports, type OpenReport } from "@/db/queries/reports";
import { formatNairobiDateTime } from "@/lib/format";
import { single, type SearchParams } from "@/lib/search-params";
import { requireRole } from "@/lib/session";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/validation/engagement";
import { MESSAGE_REPORT_REASON_LABELS, type MessageReportReason } from "@/lib/validation/messaging";

const NOTICES: Record<string, string> = {
  dismissed: "Report dismissed.",
  taken_down: "Listing taken down. The lister can see your reason, and its open reports are resolved.",
  message_dismissed: "Message report dismissed.",
  message_removed: "Message removed. Both people now see that a moderator removed it.",
  conversation_closed: "Message removed and conversation closed. Nobody can send in it any more.",
};

function MessageReportItem({ report }: { report: OpenMessageReport }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-micro text-slate-600">
          {messageReasonLabel(report.reason)} · reported {formatNairobiDateTime(report.createdAt)}
          {report.reporterName ? ` by ${report.reporterName}` : ""}
        </p>
        {/* No prefetch: opening the conversation is a logged moderator view. */}
        <Link
          href={`/admin/reports/messages/${report.id}`}
          prefetch={false}
          className={buttonClasses({ variant: "secondary" })}
        >
          Open conversation
        </Link>
      </div>
      <p className="whitespace-pre-line break-words rounded-md bg-canvas px-3 py-2 text-small text-slate-700">
        {report.excerpt}
        {report.messageLength > report.excerpt.length ? "…" : ""}
      </p>
      {report.details && <p className="whitespace-pre-line break-words text-small text-slate-700">Reporter: {report.details}</p>}
    </li>
  );
}

function messageReasonLabel(reason: string): string {
  return MESSAGE_REPORT_REASON_LABELS[reason as MessageReportReason] ?? reason;
}

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

/**
 * Open listing reports (prompt S8 decisions 4 and 12) and message reports (prompt S15 decision 13),
 * newest first. Platform admins only.
 */
async function Reports({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["platform_admin"], "/admin/reports");
  const db = getDb();
  const [params, reports, messageReports] = await Promise.all([searchParams, listOpenReports(db), listOpenMessageReports(db)]);
  const notice = NOTICES[single(params.notice) ?? ""];
  return (
    <div className="flex flex-col gap-8">
      {notice && <FormAlert state={{ message: notice }} />}
      <section aria-labelledby="listing-reports" className="flex flex-col gap-4">
        <h2 id="listing-reports" className="text-title">
          Reported listings
        </h2>
        {reports.length === 0 ? (
          <EmptyState icon={<Flag />} title="No open listing reports" description="Reports from buyers and tenants appear here." />
        ) : (
          <ul className="flex flex-col gap-4">
            {reports.map((report) => (
              <ReportItem key={report.id} report={report} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="message-reports" className="flex flex-col gap-4">
        <h2 id="message-reports" className="text-title">
          Reported messages
        </h2>
        {messageReports.length === 0 ? (
          <EmptyState icon={<MessageSquareWarning />} title="No open message reports" description="Messages people report from their inbox appear here." />
        ) : (
          <ul className="flex flex-col gap-4">
            {messageReports.map((report) => (
              <MessageReportItem key={report.id} report={report} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <AdminGate roles={["platform_admin"]} next="/admin/reports">
        <>
          <PageHeading title="Reports" description="Listings and messages people reported. Dismiss a report, or act on it with a reason." />
          <Suspense fallback={<Skeleton className="h-64" />}>
            <Reports searchParams={searchParams} />
          </Suspense>
        </>
      </AdminGate>
    </Suspense>
  );
}
