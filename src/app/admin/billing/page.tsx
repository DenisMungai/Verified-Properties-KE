import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CircleCheck, SearchX } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { AuditList, PaybillTable, PaymentTable } from "@/components/admin/billing/BillingTables";
import { ReconciliationCard } from "@/components/admin/billing/ReconciliationCard";
import { FormAlert } from "@/components/forms/FormAlert";
import { Badge, Button, EmptyState, Input, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import {
  findInvoiceSummary,
  flaggedPayments,
  latestReconciliationEvent,
  recentAuditEntries,
  searchPayments,
  unresolvedPaybillEvents,
} from "@/db/queries/billing-admin";
import { parseReconciliationReport } from "@/lib/billing/admin-view";
import { formatKes, formatNairobiDate } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/roles";
import { single, type SearchParams } from "@/lib/search-params";
import { requireRole } from "@/lib/session";
import { SEARCH_MAX, classifyBillingSearch, type BillingSearch } from "@/lib/validation/billing-admin";

export const metadata: Metadata = { title: "Billing", robots: { index: false } };

const NOTICES: Record<string, string> = {
  credit_added: "Credit added. The new period end is on the lister's billing page.",
};

const INVOICE_STATUS: Record<string, string> = { open: "Open", paid: "Paid", void: "Void", refunded: "Refunded" };

function SearchForm({ q }: { q: string }) {
  return (
    <form action="/admin/billing" method="get" role="search" className="flex flex-col gap-1.5">
      <label htmlFor="billing-q" className="text-small font-medium text-ink">
        Find a payment
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="billing-q"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={SEARCH_MAX}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="billing-q-hint"
          className="sm:max-w-md"
        />
        <Button type="submit" className="sm:w-auto">
          Search
        </Button>
      </div>
      <p id="billing-q-hint" className="text-micro text-slate-600">
        Phone, M-Pesa receipt, invoice number or card reference.
      </p>
    </form>
  );
}

const SEARCH_LABELS: Record<BillingSearch["kind"], string> = {
  invoice: "invoice",
  phone: "phone number",
  receipt: "M-Pesa receipt",
  reference: "card reference",
};

async function SearchResults({ search }: { search: BillingSearch }) {
  const db = getDb();
  const [rows, invoice] = await Promise.all([
    searchPayments(db, search),
    search.kind === "invoice" ? findInvoiceSummary(db, search.invoiceNumber) : Promise.resolve(null),
  ]);
  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-4">
      <h2 id="results-heading" className="text-title">
        Results by {SEARCH_LABELS[search.kind]}
      </h2>
      {invoice && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-white p-5 text-small">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink tabular">{invoice.invoiceNumber}</span>
            <Badge tone={invoice.status === "paid" ? "success" : "neutral"}>{INVOICE_STATUS[invoice.status] ?? invoice.status}</Badge>
          </div>
          <p className="text-slate-700">
            {invoice.planName} · {formatKes(invoice.amountKes)} · {invoice.ownerName}
          </p>
          <p className="text-micro text-slate-600">
            Created {formatNairobiDate(invoice.createdAt)}
            {invoice.periodEnd ? ` · paid until ${formatNairobiDate(invoice.periodEnd)}` : ""}
          </p>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No payments found"
          description={
            search.kind === "receipt"
              ? "No payment holds that receipt. If it's on the M-Pesa statement, record it as a Paybill payment."
              : "Check the number and try again."
          }
        />
      ) : (
        <PaymentTable rows={rows} caption="Payments matching the search, newest first" />
      )}
    </section>
  );
}

async function NeedsAttention() {
  const db = getDb();
  const [flagged, paybill, reconciliation, audit] = await Promise.all([
    flaggedPayments(db),
    unresolvedPaybillEvents(db),
    latestReconciliationEvent(db),
    recentAuditEntries(db),
  ]);
  const report = reconciliation ? parseReconciliationReport(reconciliation.payload, reconciliation.createdAt) : null;
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-8">
        <section aria-labelledby="flagged-heading" className="flex flex-col gap-4">
          <h2 id="flagged-heading" className="text-title">
            Flagged payments <span className="text-slate-600">({flagged.length})</span>
          </h2>
          {flagged.length === 0 ? (
            <EmptyState icon={<CircleCheck />} title="Nothing flagged" description="Payments that need a human check appear here." />
          ) : (
            <PaymentTable rows={flagged} caption="Flagged payments, oldest first" showFlag />
          )}
        </section>
        <section aria-labelledby="paybill-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="paybill-heading" className="text-title">
              Paybill money with no invoice <span className="text-slate-600">({paybill.length})</span>
            </h2>
            <Link href="/admin/billing/record" className={buttonClasses({ variant: "secondary", className: "self-start sm:self-auto" })}>
              Record a Paybill payment
            </Link>
          </div>
          {paybill.length === 0 ? (
            <EmptyState icon={<CircleCheck />} title="All Paybill money is matched" description="Payments with an unknown account number appear here." />
          ) : (
            <PaybillTable rows={paybill} />
          )}
        </section>
      </div>
      <div className="flex flex-col gap-6">
        <ReconciliationCard report={report} />
        <section aria-labelledby="audit-heading" className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
          <h2 id="audit-heading" className="text-title">
            Recent admin actions
          </h2>
          <AuditList entries={audit} />
        </section>
      </div>
    </div>
  );
}

async function Billing({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(ADMIN_ROLES, "/admin/billing");
  const params = await searchParams;
  const q = single(params.q) ?? "";
  const search = classifyBillingSearch(q);
  const notice = NOTICES[single(params.notice) ?? ""];
  return (
    <div className="flex flex-col gap-8">
      {notice && <FormAlert state={{ message: notice }} />}
      <SearchForm q={q.slice(0, SEARCH_MAX)} />
      {search ? <SearchResults search={search} /> : <NeedsAttention />}
    </div>
  );
}

export default function BillingAdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="Billing" description="Find payments, resolve flags and unmatched Paybill money, and check the nightly reconciliation." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Billing searchParams={searchParams} />
      </Suspense>
    </>
  );
}
