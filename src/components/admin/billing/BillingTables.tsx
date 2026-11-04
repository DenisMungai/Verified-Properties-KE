import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { AdminPaymentRow, AuditEntry, EventLogEntry, PaybillEventView } from "@/db/queries/billing-admin";
import {
  AUDIT_ACTION_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGES,
  flagReasonLabel,
  type AdminPaymentStatus,
} from "@/lib/billing/admin-view";
import { formatKes, formatNairobiDateTime } from "@/lib/format";
import { displayKenyanPhone } from "@/lib/kenya";

/** Billing admin tables and lists (prompt S10), in the moderation queue's row style. */

export function PaymentStatusBadge({ status }: { status: AdminPaymentStatus }) {
  const badge = PAYMENT_STATUS_BADGES[status];
  return <Badge tone={badge.tone}>{badge.label}</Badge>;
}

export function phoneLabel(phone: string | null): string {
  return phone ? displayKenyanPhone(phone) : "No phone";
}

const th = "px-4 py-2 font-semibold uppercase tracking-wide";
const td = "px-1 md:px-4 md:py-3";

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-line bg-white p-2 md:p-4">{children}</div>;
}

export function PaymentTable({ rows, caption, showFlag = false }: { rows: AdminPaymentRow[]; caption: string; showFlag?: boolean }) {
  return (
    <Panel>
      <table className="w-full border-separate border-spacing-y-2 text-left text-small">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden text-micro text-slate-600 md:table-header-group">
          <tr>
            <th scope="col" className={th}>Date</th>
            <th scope="col" className={th}>Owner</th>
            <th scope="col" className={th}>Phone or method</th>
            <th scope="col" className={th}>Amount</th>
            <th scope="col" className={th}>{showFlag ? "Why flagged" : "Status"}</th>
            <th scope="col" className={th}><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="flex flex-col gap-0.5 rounded-lg bg-canvas p-3 md:table-row md:p-0">
              <td className={`${td} text-slate-700 md:rounded-l-lg`}>
                <span className="tabular">{formatNairobiDateTime(row.createdAt)}</span>
                <span className="block text-micro text-slate-600 tabular">{row.invoiceNumber}</span>
              </td>
              <td className={`${td} font-medium text-ink`}>{row.ownerName}</td>
              <td className={`${td} text-slate-700`}>
                <span className="tabular">{row.phoneE164 ? displayKenyanPhone(row.phoneE164) : PAYMENT_METHOD_LABELS[row.method]}</span>
                {row.mpesaReceipt && <span className="block text-micro text-slate-600">{row.mpesaReceipt}</span>}
              </td>
              <td className={`${td} text-ink tabular`}>
                {formatKes(row.paidAmountKes ?? row.amountKes)}
                {row.paidAmountKes !== null && row.paidAmountKes !== row.amountKes && (
                  <span className="block text-micro text-warning-text">Invoice {formatKes(row.amountKes)}</span>
                )}
              </td>
              <td className={td}>
                {showFlag ? <span className="text-slate-700">{flagReasonLabel(row.flagReason)}</span> : <PaymentStatusBadge status={row.status} />}
              </td>
              <td className="md:rounded-r-lg md:px-4 md:py-1">
                <Link
                  href={`/admin/billing/payments/${row.id}`}
                  className="inline-flex min-h-control items-center px-1 font-semibold text-emerald-700 hover:underline"
                >
                  Open<span className="sr-only"> payment for {row.invoiceNumber}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function PaybillTable({ rows }: { rows: PaybillEventView[] }) {
  return (
    <Panel>
      <table className="w-full border-separate border-spacing-y-2 text-left text-small">
        <caption className="sr-only">Paybill payments that matched no invoice, oldest first</caption>
        <thead className="hidden text-micro text-slate-600 md:table-header-group">
          <tr>
            <th scope="col" className={th}>Received</th>
            <th scope="col" className={th}>Receipt</th>
            <th scope="col" className={th}>Account number typed</th>
            <th scope="col" className={th}>Amount</th>
            <th scope="col" className={th}><span className="sr-only">Resolve</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="flex flex-col gap-0.5 rounded-lg bg-canvas p-3 md:table-row md:p-0">
              <td className={`${td} text-slate-700 tabular md:rounded-l-lg`}>{formatNairobiDateTime(row.createdAt)}</td>
              <td className={`${td} font-medium text-ink`}>{row.transId ?? "Unreadable"}</td>
              <td className={`${td} text-slate-700`}>{row.billRef || "None"}</td>
              <td className={`${td} text-ink tabular`}>{row.amountKes !== null ? formatKes(row.amountKes) : "Unknown"}</td>
              <td className="md:rounded-r-lg md:px-4 md:py-1">
                <Link
                  href={`/admin/billing/paybill/${row.id}`}
                  className="inline-flex min-h-control items-center px-1 font-semibold text-emerald-700 hover:underline"
                >
                  Resolve<span className="sr-only"> Paybill payment {row.transId ?? ""}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** "payment: flagged → pending (admin)" for status changes; nothing for other events. */
function eventSummary(event: EventLogEntry): string | null {
  if (event.eventType !== "status_change" || !event.payload || typeof event.payload !== "object") return null;
  const p = event.payload as Record<string, unknown>;
  if (typeof p.entity !== "string" || typeof p.from !== "string" || typeof p.to !== "string") return null;
  const why = typeof p.reason === "string" ? ` · ${p.reason}` : "";
  return `${p.entity}: ${p.from} → ${p.to}${p.by === "admin" ? " (admin)" : ""}${why}`;
}

export function EventLog({ events }: { events: EventLogEntry[] }) {
  if (events.length === 0) return <p className="text-small text-slate-600">No events recorded.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-small font-medium text-ink">{event.eventType}</span>
            <span className="text-micro text-slate-600 tabular">
              {formatNairobiDateTime(event.createdAt)}
              {event.sourceIp ? ` · ${event.sourceIp}` : ""}
            </span>
          </div>
          {eventSummary(event) && <p className="text-small text-slate-700">{eventSummary(event)}</p>}
          <details className="group">
            <summary className="inline-flex min-h-control cursor-pointer items-center text-small font-medium text-emerald-700 hover:underline">
              Show payload
            </summary>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-canvas p-3 text-micro text-slate-700">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ol>
  );
}

export function AuditList({ entries, empty = "No admin actions yet." }: { entries: AuditEntry[]; empty?: string }) {
  if (entries.length === 0) return <p className="text-small text-slate-600">{empty}</p>;
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 text-small">
          <span className="font-medium text-ink">{AUDIT_ACTION_LABELS[entry.action] ?? entry.action}</span>
          <span className="text-micro text-slate-600">
            {formatNairobiDateTime(entry.createdAt)} · {entry.actorName}
            {entry.amountKes !== null ? ` · ${formatKes(entry.amountKes)}` : ""}
            {entry.creditDays !== null ? ` · ${entry.creditDays} ${entry.creditDays === 1 ? "day" : "days"}` : ""}
            {entry.reference ? ` · ref ${entry.reference}` : ""}
          </span>
          <span className="break-words text-slate-700">{entry.reason}</span>
        </li>
      ))}
    </ol>
  );
}

/** Label / value rows for the detail panels. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-small sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-600">{label}</dt>
          <dd className="break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
