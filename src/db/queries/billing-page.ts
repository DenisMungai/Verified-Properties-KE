import "server-only";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencyMembers, invoices, payments, plans, subscriptions } from "@/db/schema";
import { subscriptionPhase, type SubscriptionPhase } from "@/lib/billing/periods";
import { countActiveListings, getListingPool, getListingSubscription, type ListingPool, type Plan, type Subscription } from "./billing";
import { getPlan, isAgencyAdmin } from "./payments";

/**
 * Reads for the billing page, checkout and payment status (prompt S6). Every lookup by id or
 * number is scoped to what the signed-in user may see: their own subscription, or their agency's.
 */

export interface BillingOverview {
  pool: ListingPool;
  /** The user may pay and change the plan (own pool, or an agency admin). */
  canManage: boolean;
  subscription: Subscription | null;
  /** The plan on the subscription row. */
  plan: Plan | null;
  /** The plan in force now (a scheduled downgrade takes over at its change date). */
  effectivePlan: Plan | null;
  scheduledPlan: Plan | null;
  phase: SubscriptionPhase | null;
  activeListingCount: number;
  openInvoice: { invoiceNumber: string; amountKes: number; planName: string } | null;
}

export async function getBillingOverview(db: DbExecutor, userId: string, now: Date): Promise<BillingOverview> {
  const pool = await getListingPool(db, userId);
  const [canManage, live, activeListingCount] = await Promise.all([
    pool.kind === "user" ? Promise.resolve(true) : isAgencyAdmin(db, userId, pool.agencyId),
    getListingSubscription(db, pool, now),
    countActiveListings(db, pool),
  ]);
  const subscription = live?.subscription ?? null;
  const [plan, scheduledPlan, open] = await Promise.all([
    subscription ? getPlan(db, subscription.planId) : null,
    subscription?.scheduledPlanId ? getPlan(db, subscription.scheduledPlanId) : null,
    subscription
      ? db
          .select({ invoiceNumber: invoices.invoiceNumber, amountKes: invoices.amountKes, planName: plans.name })
          .from(invoices)
          .innerJoin(plans, eq(plans.id, invoices.planId))
          .where(and(eq(invoices.subscriptionId, subscription.id), eq(invoices.status, "open")))
          .orderBy(desc(invoices.createdAt))
          .limit(1)
      : [],
  ]);
  return {
    pool,
    canManage,
    subscription,
    plan,
    effectivePlan: live?.plan ?? null,
    scheduledPlan,
    phase: subscription ? subscriptionPhase(subscription, now) : null,
    activeListingCount,
    openInvoice: open[0] ?? null,
  };
}

function poolOwns(pool: ListingPool) {
  return pool.kind === "agency" ? eq(subscriptions.ownerAgencyId, pool.agencyId) : eq(subscriptions.ownerUserId, pool.userId);
}

export interface InvoiceRow {
  invoiceNumber: string;
  planName: string;
  amountKes: number;
  status: "open" | "paid" | "void" | "refunded";
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

/** The pool's invoices across all its subscriptions, newest first. */
export async function listInvoices(db: DbExecutor, pool: ListingPool, limit = 24): Promise<InvoiceRow[]> {
  return db
    .select({
      invoiceNumber: invoices.invoiceNumber,
      planName: plans.name,
      amountKes: invoices.amountKes,
      status: invoices.status,
      periodStart: invoices.periodStart,
      periodEnd: invoices.periodEnd,
      paidAt: invoices.paidAt,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
    .innerJoin(plans, eq(plans.id, invoices.planId))
    .where(and(poolOwns(pool), eq(subscriptions.kind, "listing")))
    .orderBy(desc(invoices.createdAt))
    .limit(limit);
}

/** Subscriptions the user may see: their own, or any agency they belong to. */
export function visibleToUser(db: DbExecutor, userId: string) {
  const memberAgencies = db
    .select({ agencyId: agencyMembers.agencyId })
    .from(agencyMembers)
    .where(eq(agencyMembers.userId, userId));
  return or(eq(subscriptions.ownerUserId, userId), inArray(subscriptions.ownerAgencyId, memberAgencies));
}

export interface PaymentStatusRow {
  id: string;
  method: "stk_push" | "c2b_paybill" | "manual" | "card";
  status: "pending" | "confirmed" | "failed" | "cancelled" | "flagged";
  /** Gateway status noted on a pending card payment ("failed", "abandoned", …). */
  resultDesc: string | null;
  hasCallback: boolean;
  invoiceNumber: string;
  planName: string;
  amountKes: number;
  periodEnd: Date | null;
}

async function paymentStatusWhere(db: DbExecutor, userId: string, match: ReturnType<typeof eq>): Promise<PaymentStatusRow | null> {
  const [row] = await db
    .select({
      id: payments.id,
      method: payments.method,
      status: payments.status,
      resultDesc: payments.resultDesc,
      rawCallback: payments.rawCallback,
      invoiceNumber: invoices.invoiceNumber,
      planName: plans.name,
      amountKes: invoices.amountKes,
      periodEnd: invoices.periodEnd,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
    .innerJoin(plans, eq(plans.id, invoices.planId))
    .where(and(match, visibleToUser(db, userId)))
    .limit(1);
  if (!row) return null;
  const { rawCallback, ...rest } = row;
  return { ...rest, hasCallback: rawCallback !== null };
}

/** A payment's status, only for its owner (or a member of the owning agency). */
export function getPaymentStatusForUser(db: DbExecutor, userId: string, paymentId: string): Promise<PaymentStatusRow | null> {
  return paymentStatusWhere(db, userId, eq(payments.id, paymentId));
}

export function getCardPaymentForUser(db: DbExecutor, userId: string, reference: string): Promise<PaymentStatusRow | null> {
  return paymentStatusWhere(db, userId, eq(payments.providerReference, reference));
}
