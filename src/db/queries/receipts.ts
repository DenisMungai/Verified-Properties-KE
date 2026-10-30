import "server-only";
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import {
  agencies,
  agencyMembers,
  invoices,
  listerProfiles,
  payments,
  plans,
  subscriptions,
  users,
} from "@/db/schema";
import { visibleToUser } from "./billing-page";

/**
 * Receipt reads (prompt S6 decisions 5 and 8): the receipt email and the printable receipt page.
 * Ownership is part of every page query, so another pool's invoice is simply not found.
 */

export interface ReceiptData {
  invoiceNumber: string;
  planName: string;
  amountKes: number;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date;
  /** The lister or agency the plan belongs to. */
  accountName: string;
  method: "stk_push" | "c2b_paybill" | "manual" | "card";
  mpesaReceipt: string | null;
  providerReference: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
}

const receiptColumns = {
  invoiceNumber: invoices.invoiceNumber,
  planName: plans.name,
  amountKes: invoices.amountKes,
  periodStart: invoices.periodStart,
  periodEnd: invoices.periodEnd,
  paidAt: invoices.paidAt,
  method: payments.method,
  mpesaReceipt: payments.mpesaReceipt,
  providerReference: payments.providerReference,
  cardBrand: payments.cardBrand,
  cardLast4: payments.cardLast4,
  ownerUserId: subscriptions.ownerUserId,
  ownerAgencyId: subscriptions.ownerAgencyId,
  listerName: listerProfiles.displayName,
  agencyName: agencies.name,
};

type ReceiptRow = Omit<ReceiptData, "periodStart" | "periodEnd" | "paidAt" | "accountName"> & {
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  ownerUserId: string | null;
  ownerAgencyId: string | null;
  listerName: string | null;
  agencyName: string | null;
};

function receiptQuery(db: DbExecutor) {
  return db
    .select(receiptColumns)
    .from(invoices)
    .innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
    .innerJoin(plans, eq(plans.id, invoices.planId))
    .innerJoin(payments, and(eq(payments.invoiceId, invoices.id), eq(payments.status, "confirmed")))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, subscriptions.ownerUserId))
    .leftJoin(agencies, eq(agencies.id, subscriptions.ownerAgencyId));
}

function toReceipt(row: ReceiptRow): ReceiptData | null {
  if (!row.periodStart || !row.periodEnd || !row.paidAt) return null;
  return {
    invoiceNumber: row.invoiceNumber,
    planName: row.planName,
    amountKes: row.amountKes,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    paidAt: row.paidAt,
    accountName: row.agencyName ?? row.listerName ?? "Your account",
    method: row.method,
    mpesaReceipt: row.mpesaReceipt,
    providerReference: row.providerReference,
    cardBrand: row.cardBrand,
    cardLast4: row.cardLast4,
  };
}

/** The receipt for a confirmed payment, plus the subscription owner, for the receipt email. */
export async function receiptForPayment(
  db: DbExecutor,
  paymentId: string,
): Promise<{ receipt: ReceiptData; ownerUserId: string | null; ownerAgencyId: string | null } | null> {
  const [row] = await receiptQuery(db).where(and(eq(payments.id, paymentId), eq(invoices.status, "paid"))).limit(1);
  const receipt = row ? toReceipt(row) : null;
  return receipt ? { receipt, ownerUserId: row.ownerUserId, ownerAgencyId: row.ownerAgencyId } : null;
}

/** A paid invoice's receipt, only when the user owns it or belongs to the owning agency. */
export async function receiptForUser(db: DbExecutor, userId: string, invoiceNumber: string): Promise<ReceiptData | null> {
  const [row] = await receiptQuery(db)
    .where(and(eq(invoices.invoiceNumber, invoiceNumber), eq(invoices.status, "paid"), visibleToUser(db, userId)))
    .limit(1);
  return row ? toReceipt(row) : null;
}

/** Who gets the receipt email: the owner, or every admin of the owning agency (decision 5). */
export async function receiptRecipients(
  db: DbExecutor,
  owner: { ownerUserId: string | null; ownerAgencyId: string | null },
): Promise<{ email: string; name: string }[]> {
  if (owner.ownerUserId) {
    return db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, owner.ownerUserId));
  }
  if (!owner.ownerAgencyId) return [];
  return db
    .select({ email: users.email, name: users.name })
    .from(agencyMembers)
    .innerJoin(users, eq(users.id, agencyMembers.userId))
    .where(and(eq(agencyMembers.agencyId, owner.ownerAgencyId), eq(agencyMembers.role, "admin")));
}
