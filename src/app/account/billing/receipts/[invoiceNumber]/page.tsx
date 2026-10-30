import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintButton } from "@/components/billing/PrintButton";
import { Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { receiptForUser } from "@/db/queries/receipts";
import { paidWithLabel, periodLabel } from "@/lib/billing/receipts";
import { BRAND } from "@/lib/brand";
import { formatKes, formatNairobiDateTime } from "@/lib/format";
import { requireLister } from "../../../listings/guard";

export const metadata: Metadata = { title: "Payment receipt" };

const INVOICE_NUMBER = /^VPK[0-9]{7,9}$/;

/**
 * Printable receipt (prompt S6 decisions 5 and 8): invoice number, plan, period and amount (plan
 * v2.0 §4). Only paid invoices the user owns, or their agency's; anything else is a 404.
 */
async function Receipt({ params }: { params: Promise<{ invoiceNumber: string }> }) {
  const { invoiceNumber } = await params;
  const user = await requireLister(`/account/billing/receipts/${encodeURIComponent(invoiceNumber)}`);
  const receipt = INVOICE_NUMBER.test(invoiceNumber) ? await receiptForUser(getDb(), user.id, invoiceNumber) : null;
  if (!receipt) notFound();

  const rows = [
    ["Invoice", receipt.invoiceNumber],
    ["Account", receipt.accountName],
    ["Plan", receipt.planName],
    ["Period", periodLabel(receipt.periodStart, receipt.periodEnd)],
    ["Paid on", formatNairobiDateTime(receipt.paidAt)],
    ["Paid with", paidWithLabel(receipt)],
    ...(receipt.method === "card" && receipt.providerReference ? [["Card reference", receipt.providerReference] as const] : []),
  ] as const;

  return (
    <article aria-labelledby="receipt-heading" className="mx-auto flex w-full max-w-[40rem] flex-col gap-6 rounded-xl border border-line bg-white p-4 md:p-8 print:border-0 print:p-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-body font-bold text-emerald-700">{BRAND.name}</p>
          <h1 id="receipt-heading" className="text-h2">
            Payment receipt
          </h1>
        </div>
        <PrintButton />
      </div>
      <dl className="flex flex-col divide-y divide-line border-y border-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-6">
            <dt className="text-body-sm text-slate-600">{label}</dt>
            <dd className="break-all text-body-sm font-medium text-ink tabular sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-h4">Amount paid</p>
        <p className="text-h2 tabular">{formatKes(receipt.amountKes)}</p>
      </div>
      <p className="text-caption text-slate-600">
        This is a payment receipt for your {BRAND.name} listing plan. Amounts are in Kenyan shillings.
      </p>
      <Link href="/account/billing" className={buttonClasses({ variant: "quiet", className: "self-start print:hidden" })}>
        Back to billing
      </Link>
    </article>
  );
}

export default function ReceiptPage({ params }: { params: Promise<{ invoiceNumber: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-[40rem] rounded-xl" />}>
      <Receipt params={params} />
    </Suspense>
  );
}
