import Link from "next/link";
import { Badge } from "@/components/ui";
import { PAYMENT_METHOD_LABELS, type AdminPaymentMethod, type ReconciliationReport, type ReportCheck } from "@/lib/billing/admin-view";
import { formatKes, formatNairobiDate, formatNairobiDateTime } from "@/lib/format";

/** The latest nightly reconciliation report (prompt S10 decision 12; payload from S9). */

const SHOWN_IDS = 10;

function idHref(check: ReportCheck, id: string): string {
  if (check.idKind === "invoice") return `/admin/billing?q=${encodeURIComponent(id)}`;
  if (check.idKind === "event") return `/admin/billing/paybill/${id}`;
  return `/admin/billing/payments/${id}`;
}

function idLabel(check: ReportCheck, id: string): string {
  return check.idKind === "invoice" ? id : id.slice(0, 8);
}

export function ReconciliationCard({ report }: { report: ReconciliationReport | null }) {
  return (
    <section aria-labelledby="reconciliation-heading" className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5">
      <div className="flex flex-col gap-1">
        <h2 id="reconciliation-heading" className="text-title">
          Nightly reconciliation
        </h2>
        <p className="text-small text-slate-600">
          {report ? `Last run ${formatNairobiDateTime(report.ranAt)}. Counts are from that run.` : "No report yet. It runs every night at 01:00."}
        </p>
      </div>
      {report && (
        <>
          <ul className="flex flex-col gap-3">
            {report.checks.map((check) => (
              <li key={check.name} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3 text-small">
                  <span className="text-ink">{check.label}</span>
                  {check.count === 0 ? <Badge tone="success">OK</Badge> : <Badge tone="warning">{check.count}</Badge>}
                </div>
                {check.ids.length > 0 && (
                  <p className="flex flex-wrap gap-x-3 text-micro">
                    {check.ids.slice(0, SHOWN_IDS).map((id) => (
                      <Link key={id} href={idHref(check, id)} className="font-medium text-emerald-700 hover:underline tabular">
                        {idLabel(check, id)}
                      </Link>
                    ))}
                    {check.count > SHOWN_IDS && <span className="text-slate-600">+{check.count - SHOWN_IDS} more</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {report.totals && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <h3 className="text-small font-semibold text-ink">Confirmed on {formatNairobiDate(report.totals.from)}</h3>
              <p className="text-micro text-slate-600">Compare with the M-Pesa statement for the same day.</p>
              {report.totals.byMethod.length === 0 ? (
                <p className="text-small text-slate-600">No confirmed payments that day.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-small">
                  {report.totals.byMethod.map((total) => (
                    <li key={total.method} className="flex justify-between gap-3">
                      <span className="text-slate-700">
                        {PAYMENT_METHOD_LABELS[total.method as AdminPaymentMethod] ?? total.method} · {total.count}
                      </span>
                      <span className="text-ink tabular">{formatKes(total.amountKes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
