import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { DismissMessageReportForm, RemoveMessageForm } from "@/components/admin/DecisionForms";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { MessageBubble, MessageThread } from "@/components/messaging/MessageThread";
import { listingHref } from "@/components/search/PropertyCard";
import { Badge, Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { conversationModerationHistory, getReportedThread, type ReportedThread } from "@/db/queries/message-moderation";
import { OPEN_REPORT_STATUSES } from "@/db/queries/reports";
import { formatNairobiDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { MESSAGE_REPORT_REASON_LABELS, type MessageReportReason } from "@/lib/validation/messaging";

export const metadata: Metadata = { title: "Reported conversation", robots: { index: false } };

type Params = Promise<{ id: string }>;

const ACTION_LABELS: Record<string, string> = {
  view_conversation: "Viewed conversation",
  dismiss_report: "Dismissed report",
  remove_message: "Removed message",
  close_conversation: "Closed conversation",
};

function Participants({ data }: { data: ReportedThread }) {
  const { conversation } = data;
  return (
    <dl className="grid gap-3 rounded-lg border border-line bg-white p-5 text-small sm:grid-cols-3">
      <div className="flex flex-col gap-0.5">
        <dt className="text-micro text-slate-600">Buyer (left)</dt>
        <dd className="font-semibold text-ink">{conversation.buyerName}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-micro text-slate-600">Lister (right)</dt>
        <dd className="font-semibold text-ink">{conversation.listerName}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-micro text-slate-600">Listing</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <Link
            href={conversation.propertyStatus === "published" ? listingHref(conversation.propertySlug) : `/admin/listings/${conversation.propertyId}`}
            className="font-semibold text-emerald-700 underline underline-offset-4"
          >
            {conversation.propertyTitle}
          </Link>
          <ListingStatusBadge status={conversation.propertyStatus} />
        </dd>
      </div>
    </dl>
  );
}

async function History({ conversationId }: { conversationId: string }) {
  const history = await conversationModerationHistory(getDb(), conversationId);
  if (history.length === 0) return null;
  return (
    <section aria-labelledby="history" className="flex flex-col gap-3">
      <h2 id="history" className="text-title">
        Moderation log
      </h2>
      <ul className="flex flex-col gap-2">
        {history.map((entry) => (
          <li key={entry.id} className="rounded-sm border border-line bg-white p-3 text-small">
            <p className="font-medium text-ink">
              {ACTION_LABELS[entry.action] ?? entry.action} · {entry.actorName ?? "Admin"} · {formatNairobiDateTime(entry.createdAt)}
            </p>
            {entry.reason && <p className="mt-1 whitespace-pre-line break-words text-slate-700">{entry.reason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A reported conversation for a platform admin (prompt S15 decision 13). Reached only through a
 * report; opening it writes a `view_conversation` row to the append-only moderation log.
 */
async function ReportedConversation({ params }: { params: Params }) {
  const { id } = await params;
  const admin = await requireRole(["platform_admin"], `/admin/reports/messages/${id}`);
  const data = await getReportedThread(getDb(), admin.id, id);
  if (!data) notFound();
  const { report, conversation } = data;
  const open = (OPEN_REPORT_STATUSES as readonly string[]).includes(report.status);
  const now = new Date();
  const messages = data.messages.map((message) => ({ ...message, mine: message.senderUserId === conversation.listerUserId }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={open ? "warning" : "neutral"}>{open ? "Open report" : `Report ${report.status}`}</Badge>
          {conversation.closedAt && <Badge tone="danger">Conversation closed</Badge>}
        </div>
        <p className="text-small text-slate-700">
          {MESSAGE_REPORT_REASON_LABELS[report.reason as MessageReportReason] ?? report.reason} · reported{" "}
          {formatNairobiDateTime(report.createdAt)}
          {report.reporterName ? ` by ${report.reporterName}` : ""}
        </p>
        {report.details && <p className="whitespace-pre-line break-words text-small text-slate-700">{report.details}</p>}
      </div>

      <Participants data={data} />

      <section aria-labelledby="thread" className="flex flex-col gap-3">
        <h2 id="thread" className="text-title">
          Conversation
        </h2>
        <MessageThread
          messages={messages}
          now={now}
          renderMessage={(message) => (
            <MessageBubble
              message={message}
              removed={message.removedAt !== null}
              highlight={message.id === report.messageId}
              footer={
                <>
                  {message.id === report.messageId && <span className="text-micro font-semibold text-warning-text">Reported message</span>}
                  {message.removedAt && <span className="text-micro text-slate-600">Removed {formatNairobiDateTime(message.removedAt)}</span>}
                </>
              }
            />
          )}
        />
      </section>

      {open && (
        <section aria-labelledby="decision" className="flex flex-col gap-5 rounded-lg border border-line bg-white p-5">
          <h2 id="decision" className="text-title">
            Decision
          </h2>
          <DismissMessageReportForm reportId={report.id} />
          <div className="grid gap-6 border-t border-line pt-5 md:grid-cols-2">
            <RemoveMessageForm reportId={report.id} close={false} />
            {!conversation.closedAt && <RemoveMessageForm reportId={report.id} close />}
          </div>
        </section>
      )}

      <Suspense fallback={<Skeleton className="h-24" />}>
        <History conversationId={conversation.id} />
      </Suspense>
    </div>
  );
}

export default function ReportedConversationPage({ params }: { params: Params }) {
  return (
    <>
      <Link href="/admin/reports" className="mb-2 inline-flex min-h-control items-center gap-2 text-small font-medium text-slate-700 hover:text-ink">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Reports
      </Link>
      <PageHeading title="Reported conversation" description="Every view and decision here is written to the moderation log." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <ReportedConversation params={params} />
      </Suspense>
    </>
  );
}
