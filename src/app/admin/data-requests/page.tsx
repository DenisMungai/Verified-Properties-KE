import { Suspense } from "react";
import { Inbox } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { AdminGate } from "@/components/admin/AdminGate";
import { CloseDataRequestForm } from "@/components/admin/CloseDataRequestForm";
import { FormAlert } from "@/components/forms/FormAlert";
import { EmptyState, Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { listDataRequestsForAdmin, type AdminDataRequest } from "@/db/queries/data-requests";
import { formatNairobiDate, formatNairobiDateTime } from "@/lib/format";
import { DATA_REQUEST_KIND_LABELS, requestReference, responseTargetFor } from "@/lib/legal";
import { single, type SearchParams } from "@/lib/search-params";
import { requireRole } from "@/lib/session";

const NOTICES: Record<string, string> = { closed: "Request closed. The user can see your note." };

function RequestItem({ request }: { request: AdminDataRequest }) {
  const open = request.status === "open";
  return (
    <li className="flex flex-col gap-3 rounded-sm border border-line bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <p className="text-small font-semibold text-ink">
            {DATA_REQUEST_KIND_LABELS[request.kind].label} <span className="font-normal text-slate-600">· {requestReference(request.id)}</span>
          </p>
          <p className="break-all text-micro text-slate-600">
            {request.userName} · {request.userEmail} · received {formatNairobiDateTime(request.createdAt)}
            {open ? ` · answer within ${responseTargetFor(request.kind)}` : ""}
          </p>
        </div>
        <span
          className={
            open
              ? "rounded-full bg-mint-50 px-3 py-1 text-micro font-semibold text-emerald-700"
              : "rounded-full border border-line px-3 py-1 text-micro font-semibold text-slate-600"
          }
        >
          {open ? "Open" : "Closed"}
        </span>
      </div>
      <p className="whitespace-pre-line break-words text-small text-slate-700">{request.details}</p>
      {open ? (
        <CloseDataRequestForm requestId={request.id} />
      ) : (
        <p className="whitespace-pre-line break-words rounded-md bg-mint-50 p-3 text-small text-ink">
          <span className="font-semibold">Closed {request.closedAt ? formatNairobiDate(request.closedAt) : ""}:</span> {request.resolutionNote}
        </p>
      )}
    </li>
  );
}

/** Privacy and billing requests (prompt S20 decision 7). Platform admins only. */
async function DataRequests({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["platform_admin"], "/admin/data-requests");
  const [params, requests] = await Promise.all([searchParams, listDataRequestsForAdmin(getDb())]);
  const notice = NOTICES[single(params.notice) ?? ""];
  return (
    <div className="flex flex-col gap-6">
      {notice && <FormAlert state={{ message: notice }} />}
      {requests.length === 0 ? (
        <EmptyState icon={<Inbox />} title="No data requests yet" description="Requests users send from the privacy request page appear here." />
      ) : (
        <ul className="flex flex-col gap-4">
          {requests.map((request) => (
            <RequestItem key={request.id} request={request} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DataRequestsAdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <AdminGate roles={["platform_admin"]} next="/admin/data-requests">
        <>
          <PageHeading
            title="Data requests"
            description="Privacy and billing requests from users, open ones oldest first. Close each with a note the user sees."
          />
          <Suspense fallback={<Skeleton className="h-64" />}>
            <DataRequests searchParams={searchParams} />
          </Suspense>
        </>
      </AdminGate>
    </Suspense>
  );
}
