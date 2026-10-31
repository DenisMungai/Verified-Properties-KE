import Link from "next/link";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type { InvoiceRow } from "@/db/queries/billing-page";
import { receiptPath } from "@/lib/billing/receipt-path";
import { formatKes, formatNairobiDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS: Record<InvoiceRow["status"], { label: string; className: string }> = {
  paid: { label: "Paid", className: "text-emerald-700" },
  open: { label: "Open", className: "text-warning-text" },
  void: { label: "Void", className: "text-slate-600" },
  refunded: { label: "Refunded", className: "text-slate-600" },
};

function period(row: InvoiceRow): string {
  if (!row.periodStart || !row.periodEnd) return "—";
  return `${formatNairobiDate(row.periodStart)} – ${formatNairobiDate(row.periodEnd)}`;
}

const dateOf = (row: InvoiceRow) => formatNairobiDate(row.paidAt ?? row.createdAt);

function ReceiptLink({ row }: { row: InvoiceRow }) {
  if (row.status !== "paid") return null;
  return (
    <Link
      href={receiptPath(row.invoiceNumber)}
      className="inline-flex min-h-control items-center font-medium text-emerald-700 underline underline-offset-4 hover:text-ink"
    >
      Receipt<span className="sr-only"> for {row.invoiceNumber}</span>
    </Link>
  );
}

/**
 * Design "02 — Billing & Verification" invoices: separated rows on canvas at md+, cards below.
 * Agency members who are not admins see no amounts (prompt S6 decision 10).
 */
export function InvoiceTable({ rows, showAmounts }: { rows: InvoiceRow[]; showAmounts: boolean }) {
  return (
    <section aria-labelledby="invoices-heading" className="rounded-lg border border-line bg-white p-4 md:p-5">
      <h2 id="invoices-heading" className="mb-2 text-title">
        Invoices &amp; receipts
      </h2>
      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="No invoices yet"
          description="Your invoices and receipts appear here once you choose a plan."
          className="mt-4"
        />
      ) : (
        <>
          <table className="hidden w-full border-separate border-spacing-y-2 text-small md:table">
            <caption className="sr-only">Invoices and receipts, newest first</caption>
            <thead>
              <tr className="text-left text-micro font-medium text-slate-600">
                <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Invoice</th>
                <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Billing period</th>
                <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Date</th>
                {showAmounts && <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Amount</th>}
                <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">Status</th>
                <th scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide"><span className="sr-only">Receipt</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cell = "bg-canvas px-4 py-3 align-middle first:rounded-l-lg last:rounded-r-lg";
                return (
                  <tr key={row.invoiceNumber}>
                    <td className={cn(cell, "tabular")}>{row.invoiceNumber}</td>
                    <td className={cell}>
                      {row.planName} · {period(row)}
                    </td>
                    <td className={cn(cell, "whitespace-nowrap")}>{dateOf(row)}</td>
                    {showAmounts && <td className={cn(cell, "whitespace-nowrap tabular")}>{formatKes(row.amountKes)}</td>}
                    <td className={cn(cell, "font-medium", STATUS[row.status].className)}>{STATUS[row.status].label}</td>
                    <td className={cell}>
                      <ReceiptLink row={row} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.invoiceNumber} className="flex flex-col gap-1 rounded-lg bg-canvas p-4 text-small">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium tabular">{row.invoiceNumber}</span>
                  <span className={cn("font-medium", STATUS[row.status].className)}>{STATUS[row.status].label}</span>
                </div>
                <span className="text-slate-700">
                  {row.planName} · {period(row)}
                </span>
                <span className="text-slate-600">
                  {dateOf(row)}
                  {showAmounts && <span className="tabular"> · {formatKes(row.amountKes)}</span>}
                </span>
                <ReceiptLink row={row} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
