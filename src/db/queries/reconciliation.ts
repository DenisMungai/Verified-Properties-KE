import "server-only";
import { and, eq, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { invoices, paymentEvents, payments } from "@/db/schema";

/**
 * Read-only reconciliation checks (prompt S9 decision 12). Each returns at most `limit` ids plus
 * the full count. Nothing here changes a payment; mismatches are reported for admins (S10).
 */

export interface CheckResult {
  count: number;
  /** Invoice numbers, payment ids or event ids; capped. */
  ids: string[];
}

export const RECONCILIATION_ID_LIMIT = 50;

async function check(rows: Promise<{ id: string; total: number }[]>): Promise<CheckResult> {
  const found = await rows;
  return { count: found[0]?.total ?? 0, ids: found.map((row) => row.id) };
}

const total = sql<number>`(count(*) over ())::int`;

/** Paid invoices with no confirmed payment. */
export function paidWithoutPayment(db: DbExecutor, since: Date): Promise<CheckResult> {
  return check(
    db
      .select({ id: invoices.invoiceNumber, total })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, "paid"),
          gte(invoices.createdAt, since),
          sql`not exists (select 1 from ${payments} where ${payments.invoiceId} = ${invoices.id} and ${payments.status} = 'confirmed')`,
        ),
      )
      .orderBy(invoices.createdAt)
      .limit(RECONCILIATION_ID_LIMIT),
  );
}

/** Invoices with more than one confirmed payment: money taken twice. */
export function multiplePayments(db: DbExecutor, since: Date): Promise<CheckResult> {
  return check(
    db
      .select({ id: invoices.invoiceNumber, total })
      .from(invoices)
      .innerJoin(payments, and(eq(payments.invoiceId, invoices.id), eq(payments.status, "confirmed")))
      .where(gte(invoices.createdAt, since))
      .groupBy(invoices.id, invoices.invoiceNumber)
      .having(sql`count(*) > 1`)
      .orderBy(invoices.invoiceNumber)
      .limit(RECONCILIATION_ID_LIMIT),
  );
}

/** Confirmed payments whose paid amount differs from the invoice. */
export function amountMismatches(db: DbExecutor, since: Date): Promise<CheckResult> {
  return check(
    db
      .select({ id: payments.id, total })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(
        and(
          eq(payments.status, "confirmed"),
          gte(payments.createdAt, since),
          sql`${payments.paidAmountKes} is distinct from ${invoices.amountKes}`,
        ),
      )
      .orderBy(payments.createdAt)
      .limit(RECONCILIATION_ID_LIMIT),
  );
}

/** Confirmed payments whose invoice is not marked paid. */
export function paymentInvoiceNotPaid(db: DbExecutor, since: Date): Promise<CheckResult> {
  return check(
    db
      .select({ id: payments.id, total })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(eq(payments.status, "confirmed"), gte(payments.createdAt, since), ne(invoices.status, "paid")))
      .orderBy(payments.createdAt)
      .limit(RECONCILIATION_ID_LIMIT),
  );
}

/** Paybill confirmations that matched no invoice: money in with nothing to apply it to. */
export function unmatchedPaybill(db: DbExecutor, since: Date): Promise<CheckResult> {
  return check(
    db
      .select({ id: paymentEvents.id, total })
      .from(paymentEvents)
      .where(and(eq(paymentEvents.eventType, "c2b_confirmation"), isNull(paymentEvents.invoiceId), gte(paymentEvents.createdAt, since)))
      .orderBy(paymentEvents.createdAt)
      .limit(RECONCILIATION_ID_LIMIT),
  );
}

/** Flagged payments waiting for an admin, all time. */
export function flaggedOpen(db: DbExecutor): Promise<CheckResult> {
  return check(
    db
      .select({ id: payments.id, total })
      .from(payments)
      .where(eq(payments.status, "flagged"))
      .orderBy(payments.createdAt)
      .limit(RECONCILIATION_ID_LIMIT),
  );
}

/** Payments still pending after `startedBy` (24 hours before the run). */
export function stuckPending(db: DbExecutor, since: Date, startedBy: Date): Promise<CheckResult> {
  return check(
    db
      .select({ id: payments.id, total })
      .from(payments)
      .where(and(eq(payments.status, "pending"), gte(payments.createdAt, since), lte(payments.createdAt, startedBy)))
      .orderBy(payments.createdAt)
      .limit(RECONCILIATION_ID_LIMIT),
  );
}

export interface MethodTotal {
  method: string;
  count: number;
  amountKes: number;
}

/** Confirmed payments in `[from, to)` by method, to compare with the M-Pesa statement by hand. */
export async function confirmedTotals(db: DbExecutor, from: Date, to: Date): Promise<MethodTotal[]> {
  return db
    .select({
      method: payments.method,
      count: sql<number>`count(*)::int`,
      amountKes: sql<number>`coalesce(sum(${payments.paidAmountKes}), 0)::int`,
    })
    .from(payments)
    .where(and(eq(payments.status, "confirmed"), gte(payments.confirmedAt, from), lt(payments.confirmedAt, to)))
    .groupBy(payments.method)
    .orderBy(payments.method);
}
