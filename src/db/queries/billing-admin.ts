import "server-only";
import { aliasedTable, and, asc, count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, billingAuditLog, invoices, paymentEvents, payments, plans, subscriptions, users } from "@/db/schema";
import { parseC2b, wholeKes } from "@/lib/mpesa/payloads";
import type { BillingSearch } from "@/lib/validation/billing-admin";
import { unresolvedPaybillEvent } from "./reconciliation";

/**
 * Reads for the billing admin screens (prompt S10). Admin-only callers: these return phones,
 * receipts and raw payloads, so never use them on a lister- or buyer-facing page.
 */

export const ADMIN_LIST_LIMIT = 50;
const EVENT_LOG_LIMIT = 200;

export type AdminPaymentStatus = (typeof payments.status.enumValues)[number];
export type AdminPaymentMethod = (typeof payments.method.enumValues)[number];

export interface AdminPaymentRow {
  id: string;
  createdAt: Date;
  method: AdminPaymentMethod;
  status: AdminPaymentStatus;
  flagReason: string | null;
  phoneE164: string | null;
  mpesaReceipt: string | null;
  amountKes: number;
  paidAmountKes: number | null;
  invoiceNumber: string;
  ownerName: string;
}

const ownerUsers = aliasedTable(users, "owner_users");
const ownerName = sql<string>`coalesce(${agencies.name}, ${ownerUsers.name}, 'Unknown owner')`;

function paymentRows(db: DbExecutor, where: SQL | undefined, order: "newest" | "oldest" = "newest") {
  return db
    .select({
      id: payments.id,
      createdAt: payments.createdAt,
      method: payments.method,
      status: payments.status,
      flagReason: payments.flagReason,
      phoneE164: payments.phoneE164,
      mpesaReceipt: payments.mpesaReceipt,
      amountKes: payments.amountKes,
      paidAmountKes: payments.paidAmountKes,
      invoiceNumber: invoices.invoiceNumber,
      ownerName,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
    .leftJoin(ownerUsers, eq(ownerUsers.id, subscriptions.ownerUserId))
    .leftJoin(agencies, eq(agencies.id, subscriptions.ownerAgencyId))
    .where(where)
    .orderBy(order === "newest" ? desc(payments.createdAt) : asc(payments.createdAt))
    .limit(ADMIN_LIST_LIMIT);
}

function searchCondition(search: BillingSearch): SQL {
  switch (search.kind) {
    case "invoice":
      return eq(invoices.invoiceNumber, search.invoiceNumber);
    case "phone":
      return eq(payments.phoneE164, search.e164);
    case "receipt":
      return eq(payments.mpesaReceipt, search.receipt);
    case "reference":
      return eq(payments.providerReference, search.reference);
  }
}

export function searchPayments(db: DbExecutor, search: BillingSearch): Promise<AdminPaymentRow[]> {
  return paymentRows(db, searchCondition(search));
}

/** Flagged payments waiting for an admin, oldest first. */
export function flaggedPayments(db: DbExecutor): Promise<AdminPaymentRow[]> {
  return paymentRows(db, eq(payments.status, "flagged"), "oldest");
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: (typeof invoices.status.enumValues)[number];
  amountKes: number;
  planName: string;
  ownerName: string;
  createdAt: Date;
  periodEnd: Date | null;
}

/** An invoice by number, shown above search results even when nothing was paid on it. */
export async function findInvoiceSummary(db: DbExecutor, invoiceNumber: string): Promise<InvoiceSummary | null> {
  const [row] = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      amountKes: invoices.amountKes,
      planName: plans.name,
      ownerName,
      createdAt: invoices.createdAt,
      periodEnd: invoices.periodEnd,
    })
    .from(invoices)
    .innerJoin(plans, eq(plans.id, invoices.planId))
    .innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
    .leftJoin(ownerUsers, eq(ownerUsers.id, subscriptions.ownerUserId))
    .leftJoin(agencies, eq(agencies.id, subscriptions.ownerAgencyId))
    .where(eq(invoices.invoiceNumber, invoiceNumber))
    .limit(1);
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* One payment                                                                */
/* -------------------------------------------------------------------------- */

export async function getAdminPaymentDetail(db: DbExecutor, paymentId: string) {
  const invoicePlans = aliasedTable(plans, "invoice_plans");
  const [row] = await db
    .select({
      payment: {
        id: payments.id,
        createdAt: payments.createdAt,
        method: payments.method,
        status: payments.status,
        flagReason: payments.flagReason,
        phoneE164: payments.phoneE164,
        checkoutRequestId: payments.checkoutRequestId,
        mpesaReceipt: payments.mpesaReceipt,
        providerReference: payments.providerReference,
        cardBrand: payments.cardBrand,
        cardLast4: payments.cardLast4,
        amountKes: payments.amountKes,
        paidAmountKes: payments.paidAmountKes,
        resultCode: payments.resultCode,
        resultDesc: payments.resultDesc,
        hasCallback: sql<boolean>`${payments.rawCallback} is not null`,
        confirmedAt: payments.confirmedAt,
      },
      invoice: {
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        amountKes: invoices.amountKes,
        periodStart: invoices.periodStart,
        periodEnd: invoices.periodEnd,
        paidAt: invoices.paidAt,
        planName: invoicePlans.name,
      },
      subscription: {
        id: subscriptions.id,
        kind: subscriptions.kind,
        status: subscriptions.status,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        graceEndsAt: subscriptions.graceEndsAt,
        scheduledChangeAt: subscriptions.scheduledChangeAt,
        planName: plans.name,
        planPriceKes: plans.priceKes,
      },
      owner: {
        kind: sql<"agency" | "user">`case when ${subscriptions.ownerAgencyId} is null then 'user' else 'agency' end`,
        name: ownerName,
        email: ownerUsers.email,
      },
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(invoicePlans, eq(invoicePlans.id, invoices.planId))
    .innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .leftJoin(ownerUsers, eq(ownerUsers.id, subscriptions.ownerUserId))
    .leftJoin(agencies, eq(agencies.id, subscriptions.ownerAgencyId))
    .where(eq(payments.id, paymentId))
    .limit(1);
  return row ?? null;
}

export type AdminPaymentDetail = NonNullable<Awaited<ReturnType<typeof getAdminPaymentDetail>>>;

/** Other payments on the same invoice (a double payment shows up here). */
export function paymentsOnInvoice(db: DbExecutor, invoiceId: string): Promise<AdminPaymentRow[]> {
  return paymentRows(db, eq(payments.invoiceId, invoiceId), "oldest");
}

export interface EventLogEntry {
  id: string;
  createdAt: Date;
  eventType: string;
  sourceIp: string | null;
  paymentId: string | null;
  payload: unknown;
}

/** Events for the payment and for its invoice, oldest first (decision 11). */
export function paymentEventLog(db: DbExecutor, paymentId: string, invoiceId: string): Promise<EventLogEntry[]> {
  return db
    .select({
      id: paymentEvents.id,
      createdAt: paymentEvents.createdAt,
      eventType: paymentEvents.eventType,
      sourceIp: paymentEvents.sourceIp,
      paymentId: paymentEvents.paymentId,
      payload: paymentEvents.payload,
    })
    .from(paymentEvents)
    .where(or(eq(paymentEvents.paymentId, paymentId), eq(paymentEvents.invoiceId, invoiceId)))
    .orderBy(asc(paymentEvents.createdAt))
    .limit(EVENT_LOG_LIMIT);
}

export interface AuditEntry {
  id: string;
  createdAt: Date;
  action: string;
  actorName: string;
  amountKes: number | null;
  creditDays: number | null;
  reference: string | null;
  reason: string;
}

const auditColumns = {
  id: billingAuditLog.id,
  createdAt: billingAuditLog.createdAt,
  action: billingAuditLog.action,
  actorName: users.name,
  amountKes: billingAuditLog.amountKes,
  creditDays: billingAuditLog.creditDays,
  reference: billingAuditLog.reference,
  reason: billingAuditLog.reason,
};

/** Audit entries touching the payment, its invoice or its subscription, newest first. */
export function auditEntriesFor(
  db: DbExecutor,
  ids: { paymentId: string; invoiceId: string; subscriptionId: string },
): Promise<AuditEntry[]> {
  return db
    .select(auditColumns)
    .from(billingAuditLog)
    .innerJoin(users, eq(users.id, billingAuditLog.actorUserId))
    .where(
      or(
        eq(billingAuditLog.paymentId, ids.paymentId),
        eq(billingAuditLog.invoiceId, ids.invoiceId),
        eq(billingAuditLog.subscriptionId, ids.subscriptionId),
      ),
    )
    .orderBy(desc(billingAuditLog.createdAt))
    .limit(ADMIN_LIST_LIMIT);
}

export function recentAuditEntries(db: DbExecutor, limit = 10): Promise<AuditEntry[]> {
  return db
    .select(auditColumns)
    .from(billingAuditLog)
    .innerJoin(users, eq(users.id, billingAuditLog.actorUserId))
    .orderBy(desc(billingAuditLog.createdAt))
    .limit(limit);
}

export type AuditAction =
  | "activate_payment"
  | "apply_paybill"
  | "record_paybill"
  | "refund_payment"
  | "refund_paybill"
  | "close_payment"
  | "credit_from_payment"
  | "credit_days"
  | "verification_credit"
  /** A lister's own listing plan, cancelled when they joined an agency (prompt S23 decision 5). */
  | "agency_join_plan_cancelled";

/** Append-only (trigger); written in the same transaction as the action it records. */
export async function insertBillingAudit(
  tx: DbExecutor,
  row: {
    actorUserId: string;
    action: AuditAction;
    reason: string;
    subscriptionId?: string | null;
    invoiceId?: string | null;
    paymentId?: string | null;
    amountKes?: number | null;
    reference?: string | null;
    creditDays?: number | null;
  },
): Promise<void> {
  await tx.insert(billingAuditLog).values(row);
}

/* -------------------------------------------------------------------------- */
/* Unmatched Paybill money                                                    */
/* -------------------------------------------------------------------------- */

export interface PaybillEventView {
  id: string;
  createdAt: Date;
  sourceIp: string | null;
  transId: string | null;
  amountKes: number | null;
  billRef: string | null;
  msisdn: string | null;
  payload: unknown;
}

function paybillView(row: { id: string; createdAt: Date; sourceIp: string | null; payload: unknown }): PaybillEventView {
  const c2b = parseC2b(row.payload);
  return {
    ...row,
    transId: c2b?.transId ?? null,
    amountKes: c2b ? wholeKes(c2b.amount) : null,
    billRef: c2b?.billRef ?? null,
    msisdn: c2b?.msisdn ?? null,
  };
}

const paybillColumns = {
  id: paymentEvents.id,
  createdAt: paymentEvents.createdAt,
  sourceIp: paymentEvents.sourceIp,
  payload: paymentEvents.payload,
};

/** Paybill money that matched no invoice and is still unresolved, oldest first. */
export async function unresolvedPaybillEvents(db: DbExecutor): Promise<PaybillEventView[]> {
  const rows = await db
    .select(paybillColumns)
    .from(paymentEvents)
    .where(unresolvedPaybillEvent())
    .orderBy(asc(paymentEvents.createdAt))
    .limit(ADMIN_LIST_LIMIT);
  return rows.map(paybillView);
}

export type PaybillResolution =
  | { kind: "payment"; paymentId: string }
  | { kind: "refunded"; at: Date; reference: string | null }
  | null;

/** One unmatched Paybill confirmation and how it was resolved, if it was. */
export async function getPaybillEvent(
  db: DbExecutor,
  eventId: string,
): Promise<{ event: PaybillEventView; resolution: PaybillResolution } | null> {
  const [row] = await db
    .select(paybillColumns)
    .from(paymentEvents)
    .where(and(eq(paymentEvents.id, eventId), eq(paymentEvents.eventType, "c2b_confirmation"), sql`${paymentEvents.invoiceId} is null`))
    .limit(1);
  if (!row) return null;
  const event = paybillView(row);
  return { event, resolution: await paybillResolution(db, event) };
}

async function paybillResolution(db: DbExecutor, event: PaybillEventView): Promise<PaybillResolution> {
  if (event.transId) {
    const [payment] = await db.select({ id: payments.id }).from(payments).where(eq(payments.mpesaReceipt, event.transId)).limit(1);
    if (payment) return { kind: "payment", paymentId: payment.id };
  }
  const [refund] = await db
    .select({ createdAt: paymentEvents.createdAt, payload: paymentEvents.payload })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.eventType, "admin_resolution"), sql`${paymentEvents.payload} ->> 'sourceEventId' = ${event.id}`))
    .limit(1);
  if (!refund) return null;
  const reference = (refund.payload as { reference?: unknown } | null)?.reference;
  return { kind: "refunded", at: refund.createdAt, reference: typeof reference === "string" ? reference : null };
}

/** A Paybill confirmation already recorded for this TransID (the record page's hint). */
export async function findPaybillEventByTransId(db: DbExecutor, transId: string): Promise<{ id: string; createdAt: Date } | null> {
  const [row] = await db
    .select({ id: paymentEvents.id, createdAt: paymentEvents.createdAt })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.eventType, "c2b_confirmation"), sql`${paymentEvents.payload} ->> 'TransID' = ${transId}`))
    .orderBy(asc(paymentEvents.createdAt))
    .limit(1);
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export async function billingAttentionCounts(db: DbExecutor): Promise<{ flagged: number; unmatchedPaybill: number }> {
  const [[flagged], [unmatched]] = await Promise.all([
    db.select({ n: count() }).from(payments).where(eq(payments.status, "flagged")),
    db.select({ n: count() }).from(paymentEvents).where(unresolvedPaybillEvent()),
  ]);
  return { flagged: flagged?.n ?? 0, unmatchedPaybill: unmatched?.n ?? 0 };
}

/** The newest nightly reconciliation report (S9), or null before the first run. */
export async function latestReconciliationEvent(db: DbExecutor): Promise<{ createdAt: Date; payload: unknown } | null> {
  const [row] = await db
    .select({ createdAt: paymentEvents.createdAt, payload: paymentEvents.payload })
    .from(paymentEvents)
    .where(eq(paymentEvents.eventType, "reconciliation"))
    .orderBy(desc(paymentEvents.createdAt))
    .limit(1);
  return row ?? null;
}
