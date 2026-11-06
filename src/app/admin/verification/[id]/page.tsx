import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { Badge, Skeleton, type BadgeTone } from "@/components/ui";
import { ReviewPanel, SuspendPanel } from "@/components/verification/ReviewPanel";
import { getDb } from "@/db";
import { getRequestForReview } from "@/db/queries/verification";
import { formatNairobiDate, formatNairobiDateTime } from "@/lib/format";
import { LISTER_TYPE_LABELS } from "@/lib/roles";
import { requireRole } from "@/lib/session";
import {
  AUDIT_LABELS,
  DOCUMENT_LABELS,
  isDocumentType,
  requestNumber,
  requiredDocumentTypes,
  type AuditAction,
  type VerificationStatus,
} from "@/lib/verification/rules";

export const metadata: Metadata = { title: "Verification review", robots: { index: false } };

type Params = Promise<{ id: string }>;

const STATUS_BADGES: Record<VerificationStatus, { label: string; tone: BadgeTone }> = {
  unverified: { label: "Unverified", tone: "neutral" },
  payment_pending: { label: "Awaiting payment", tone: "neutral" },
  documents_pending: { label: "Waiting on lister", tone: "warning" },
  under_review: { label: "Pending review", tone: "warning" },
  verified: { label: "Verified", tone: "verified" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  suspended: { label: "Suspended", tone: "danger" },
};

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function auditLabel(action: string): string {
  return AUDIT_LABELS[action as AuditAction] ?? action;
}

/** Design "05 — Verification Review" (prompt S12 decision 8). Platform admins only. */
async function Review({ params }: { params: Params }) {
  const admin = await requireRole(["platform_admin"], "/admin/verification");
  const { id } = await params;
  await connection();
  const detail = await getRequestForReview(getDb(), id);
  if (!detail) notFound();
  const { request, lister, documents, audit } = detail;
  const status = STATUS_BADGES[request.status];
  const own = request.listerUserId === admin.id;
  const required = requiredDocumentTypes(lister.listerType, lister.agencyId !== null);
  const refundOwed = request.status === "rejected" && audit.some((entry) => entry.action === "credit_skipped");

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="applicant-heading" className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="applicant-heading" className="text-title">
            {lister.agencyName ?? lister.displayName}
          </h2>
          <p className="text-small text-slate-600">
            {lister.agencyName ? `${lister.displayName} · ` : ""}
            {LISTER_TYPE_LABELS[lister.listerType]}
            {request.submittedAt ? ` · Submitted ${formatNairobiDate(request.submittedAt)}` : ""} · Application {requestNumber(request.id)}
          </p>
          <p className="break-all text-micro text-slate-600">
            {lister.email}
            {lister.phone ? ` · ${lister.phone}` : ""}
          </p>
        </div>
        <Badge tone={status.tone} className="self-start sm:self-center">
          {status.label}
        </Badge>
      </section>

      {own && (
        <p className="rounded-md bg-warning-tint px-4 py-3 text-small text-warning-text">
          This is your own verification. Another admin has to decide on it.
        </p>
      )}
      {refundOwed && (
        <p className="rounded-md bg-warning-tint px-4 py-3 text-small text-warning-text">
          Refund owed: the fee couldn&apos;t be credited to the lister&apos;s listing plan. Refund it by M-Pesa and record it in Billing.
        </p>
      )}
      {request.decisionReason && request.status !== "under_review" && (
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-white p-5">
          <h2 className="text-title">Last reason given</h2>
          <p className="whitespace-pre-line text-small text-ink">{request.decisionReason}</p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="documents-heading" className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-white p-5 md:p-6">
          <h2 id="documents-heading" className="text-title">
            Submitted documents
          </h2>
          <p className="text-micro text-slate-600">
            Required for this lister: {required.map((type) => DOCUMENT_LABELS[type].label).join(", ")}. Each view is logged.
          </p>
          {documents.length === 0 ? (
            <p className="text-small text-slate-600">No documents uploaded yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 rounded-sm bg-canvas p-3">
                  <span aria-hidden="true" className="inline-flex size-control shrink-0 items-center justify-center rounded-sm bg-mint-50 text-micro font-semibold text-emerald-700">
                    {doc.contentType === "application/pdf" ? <FileText className="size-4" /> : <ImageIcon className="size-4" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-small font-semibold text-ink">
                      {isDocumentType(doc.documentType) ? DOCUMENT_LABELS[doc.documentType].label : doc.documentType}
                    </span>
                    <span className="truncate text-micro text-slate-600">
                      {doc.fileName} · {doc.contentType === "application/pdf" ? "PDF" : "Image"} · {formatSize(doc.sizeBytes)}
                    </span>
                  </span>
                  <a
                    href={`/admin/verification/documents/${doc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-control items-center gap-1 px-2 text-small font-semibold text-emerald-700 hover:underline"
                  >
                    View<span className="sr-only"> {doc.fileName} (opens in a new tab)</span>
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          {request.status === "under_review" && !own ? (
            <ReviewPanel requestId={request.id} />
          ) : (
            <section className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
              <h2 className="text-title">Decision</h2>
              {request.status === "verified" && request.reviewExpiresAt && (
                <p className="text-small text-ink">Approved. The review is valid until {formatNairobiDate(request.reviewExpiresAt)}.</p>
              )}
              {request.status !== "under_review" && request.status !== "verified" && (
                <p className="text-small text-slate-700">There&apos;s nothing to decide while the request is {status.label.toLowerCase()}.</p>
              )}
              {request.status === "verified" && !own && <SuspendPanel requestId={request.id} />}
            </section>
          )}
        </div>
      </div>

      <section aria-labelledby="history-heading" className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
        <h2 id="history-heading" className="text-title">
          History
        </h2>
        <ol className="flex flex-col gap-3">
          {audit.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 text-small">
              <span className="font-medium text-ink">{auditLabel(entry.action)}</span>
              <span className="text-micro text-slate-600">
                {formatNairobiDateTime(entry.createdAt)}
                {entry.actorName ? ` · ${entry.actorName}` : ""}
              </span>
              {entry.reason && entry.action !== "view_document" && entry.action !== "upload" && entry.action !== "remove_document" && (
                <span className="text-slate-700">{entry.reason}</span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function VerificationReviewPage({ params }: { params: Params }) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/verification" className="-my-3 inline-flex min-h-control items-center gap-1 self-start text-small font-medium text-emerald-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to the queue
      </Link>
      <h1 className="text-display-sm">Verification review</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Review params={params} />
      </Suspense>
    </div>
  );
}
