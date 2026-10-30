import "server-only";
import { recordPaymentEvent } from "@/db/queries/payments";
import {
  amountMismatches,
  confirmedTotals,
  flaggedOpen,
  multiplePayments,
  paidWithoutPayment,
  paymentInvoiceNotPaid,
  stuckPending,
  unmatchedPaybill,
  type CheckResult,
} from "@/db/queries/reconciliation";
import { DAY_MS } from "@/lib/billing/constants";
import type { JobDeps, JobResult } from "./types";

/**
 * Nightly reconciliation (plan v2.0 §4 "Payment security"; prompt S9 decision 12). Read-only
 * checks of paid invoices against confirmed payments; the report is one append-only
 * `reconciliation` payment event (ids and counts only) that S10 shows to billing admins. The
 * previous Nairobi day's confirmed totals are included for a hand check against the M-Pesa
 * statement, which Daraja's standard APIs don't provide.
 */

export const RECONCILIATION_WINDOW_DAYS = 35;
const STUCK_AFTER_MS = DAY_MS;
/** Nairobi is UTC+3 all year (no daylight saving). */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** The UTC instant at which the Nairobi calendar day containing `at` began. */
export function startOfNairobiDay(at: Date): Date {
  const local = at.getTime() + NAIROBI_OFFSET_MS;
  return new Date(local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - NAIROBI_OFFSET_MS);
}

export const CHECK_NAMES = [
  "paid_without_payment",
  "multiple_payments",
  "amount_mismatch",
  "payment_invoice_not_paid",
  "unmatched_paybill",
  "flagged_open",
  "stuck_pending",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export async function runReconciliation(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const since = new Date(now.getTime() - RECONCILIATION_WINDOW_DAYS * DAY_MS);
  const today = startOfNairobiDay(now);
  const yesterday = new Date(today.getTime() - DAY_MS);
  const db = deps.db;

  const results: Record<CheckName, CheckResult> = {
    paid_without_payment: await paidWithoutPayment(db, since),
    multiple_payments: await multiplePayments(db, since),
    amount_mismatch: await amountMismatches(db, since),
    payment_invoice_not_paid: await paymentInvoiceNotPaid(db, since),
    unmatched_paybill: await unmatchedPaybill(db, since),
    flagged_open: await flaggedOpen(db),
    stuck_pending: await stuckPending(db, since, new Date(now.getTime() - STUCK_AFTER_MS)),
  };
  const dailyTotals = await confirmedTotals(db, yesterday, today);

  await recordPaymentEvent(db, {
    eventType: "reconciliation",
    payload: {
      ranAt: now.toISOString(),
      windowStart: since.toISOString(),
      checks: results,
      dailyTotals: { from: yesterday.toISOString(), to: today.toISOString(), byMethod: dailyTotals },
    },
  });

  const counts: Record<string, number> = {};
  const ids: Record<string, string[]> = {};
  for (const name of CHECK_NAMES) {
    counts[name] = results[name].count;
    if (results[name].ids.length > 0) ids[name] = results[name].ids;
  }
  for (const total of dailyTotals) {
    counts[`yesterday_${total.method}_count`] = total.count;
    counts[`yesterday_${total.method}_kes`] = total.amountKes;
  }
  const mismatches = CHECK_NAMES.filter((name) => results[name].count > 0);
  if (mismatches.length > 0) {
    console.warn(`[jobs] reconciliation mismatches=${mismatches.map((name) => `${name}:${results[name].count}`).join(",")}`);
  }
  return { status: "ok", counts, ids };
}
