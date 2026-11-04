import type { BadgeTone } from "@/components/ui";

/**
 * Labels and parsing for the billing admin screens (prompt S10). Pure; no data access.
 */

export type AdminPaymentStatus = "pending" | "confirmed" | "failed" | "cancelled" | "flagged" | "refunded" | "credited";
export type AdminPaymentMethod = "stk_push" | "c2b_paybill" | "manual" | "card";

export const PAYMENT_STATUS_BADGES: Record<AdminPaymentStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "success" },
  failed: { label: "Failed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  flagged: { label: "Flagged", tone: "warning" },
  refunded: { label: "Refunded", tone: "info" },
  credited: { label: "Credited", tone: "info" },
};

export const PAYMENT_METHOD_LABELS: Record<AdminPaymentMethod, string> = {
  stk_push: "M-Pesa prompt",
  c2b_paybill: "Paybill",
  manual: "Recorded by admin",
  card: "Card",
};

export const FLAG_REASON_LABELS: Record<string, string> = {
  amount_mismatch: "Amount doesn't match the invoice",
  duplicate_receipt: "Receipt already used by another payment",
  invoice_not_open: "Invoice was already paid or closed",
  callback_query_mismatch: "Callback and M-Pesa query disagree",
  missing_receipt: "M-Pesa says paid, but no callback arrived",
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  activate_payment: "Activated after checking the statement",
  apply_paybill: "Paybill money applied to an invoice",
  record_paybill: "Paybill payment recorded",
  refund_payment: "Refund recorded",
  refund_paybill: "Paybill refund recorded",
  close_payment: "Closed, no money kept",
  credit_from_payment: "Payment turned into plan days",
  credit_days: "Goodwill credit",
};

export function flagReasonLabel(reason: string | null): string {
  return reason ? (FLAG_REASON_LABELS[reason] ?? reason) : "No reason recorded";
}

/* -------------------------------------------------------------------------- */
/* Reconciliation report (S9 decision 12 payload)                             */
/* -------------------------------------------------------------------------- */

export type ReportIdKind = "invoice" | "payment" | "event";

const CHECKS: { name: string; label: string; idKind: ReportIdKind }[] = [
  { name: "flagged_open", label: "Flagged payments waiting", idKind: "payment" },
  { name: "unmatched_paybill", label: "Paybill money with no invoice", idKind: "event" },
  { name: "paid_without_payment", label: "Paid invoices with no payment", idKind: "invoice" },
  { name: "multiple_payments", label: "Invoices paid more than once", idKind: "invoice" },
  { name: "amount_mismatch", label: "Confirmed amount differs from invoice", idKind: "payment" },
  { name: "payment_invoice_not_paid", label: "Confirmed payment, invoice not paid", idKind: "payment" },
  { name: "stuck_pending", label: "Payments pending over 24 hours", idKind: "payment" },
];

export interface ReportCheck {
  name: string;
  label: string;
  idKind: ReportIdKind;
  count: number;
  ids: string[];
}

export interface ReportTotal {
  method: string;
  count: number;
  amountKes: number;
}

export interface ReconciliationReport {
  ranAt: Date;
  checks: ReportCheck[];
  totals: { from: Date; to: Date; byMethod: ReportTotal[] } | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function validDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Reads a stored report defensively: a malformed payload shows as zeros, never crashes the page. */
export function parseReconciliationReport(payload: unknown, fallbackRanAt: Date): ReconciliationReport {
  const root = record(payload) ?? {};
  const checks = record(root.checks) ?? {};
  const totalsRoot = record(root.dailyTotals);
  const byMethod = Array.isArray(totalsRoot?.byMethod) ? totalsRoot.byMethod : [];
  const from = validDate(totalsRoot?.from);
  const to = validDate(totalsRoot?.to);
  return {
    ranAt: validDate(root.ranAt) ?? fallbackRanAt,
    checks: CHECKS.map(({ name, label, idKind }) => {
      const check = record(checks[name]);
      const ids = Array.isArray(check?.ids) ? check.ids.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
      return { name, label, idKind, count: count(check?.count), ids };
    }),
    totals:
      from && to
        ? {
            from,
            to,
            byMethod: byMethod.flatMap((row): ReportTotal[] => {
              const r = record(row);
              return r && typeof r.method === "string" ? [{ method: r.method, count: count(r.count), amountKes: count(r.amountKes) }] : [];
            }),
          }
        : null,
  };
}
