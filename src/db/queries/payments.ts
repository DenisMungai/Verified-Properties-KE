import "server-only";
import { and, desc, eq, gt, inArray, isNull, lte, max, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import {
  agencyMembers,
  invoices,
  paymentEvents,
  payments,
  plans,
  properties,
  subscriptions,
} from "@/db/schema";
import type { PlanKind } from "@/lib/billing/constants";
import { pickListingsToKeep, remainingSlots } from "@/lib/billing/entitlements";
import { countActiveListings, type ListingPool } from "./billing";

/**
 * Payment reads and writes (prompt S5). Each takes a `DbExecutor`, so the domain code in
 * src/lib/mpesa runs them inside one transaction and tests run them against the test branch.
 * Nothing here decides an outcome; it only loads, locks and writes rows.
 */

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentStatus = Payment["status"];

/** Who owns a subscription: a lister, or an agency for agency listing plans. */
export type SubscriptionOwner = { kind: "user"; userId: string } | { kind: "agency"; agencyId: string };

/** Statuses that hold an owner's single live subscription slot (matches the partial unique index). */
const LIVE_STATUSES = ["pending", "active", "past_due", "paused"] as const;

/** Billing pauses that a renewal undoes. Other pauses stay. */
export const RESTORABLE_PAUSE_REASONS = ["plan_lapsed", "over_plan_limit"] as const;

export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function ownerCondition(owner: SubscriptionOwner) {
  return owner.kind === "agency"
    ? eq(subscriptions.ownerAgencyId, owner.agencyId)
    : eq(subscriptions.ownerUserId, owner.userId);
}

export function ownerOf(sub: Pick<Subscription, "ownerUserId" | "ownerAgencyId">): SubscriptionOwner {
  return sub.ownerAgencyId ? { kind: "agency", agencyId: sub.ownerAgencyId } : { kind: "user", userId: sub.ownerUserId! };
}

/* -------------------------------------------------------------------------- */
/* Plans, agencies                                                            */
/* -------------------------------------------------------------------------- */

export async function getActivePlanByCode(db: DbExecutor, code: string): Promise<Plan | null> {
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.code, code), eq(plans.isActive, true)))
    .limit(1);
  return row ?? null;
}

export async function getPlan(db: DbExecutor, id: string): Promise<Plan | null> {
  const [row] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return row ?? null;
}

export async function isAgencyAdmin(db: DbExecutor, userId: string, agencyId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: agencyMembers.role })
    .from(agencyMembers)
    .where(and(eq(agencyMembers.userId, userId), eq(agencyMembers.agencyId, agencyId)))
    .limit(1);
  return row?.role === "admin";
}

/* -------------------------------------------------------------------------- */
/* Subscriptions and invoices                                                 */
/* -------------------------------------------------------------------------- */

/** The owner's live subscription of this kind, locked for the rest of the transaction. */
export async function lockLiveSubscription(
  tx: DbExecutor,
  owner: SubscriptionOwner,
  kind: PlanKind,
): Promise<Subscription | null> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(and(ownerCondition(owner), eq(subscriptions.kind, kind), inArray(subscriptions.status, [...LIVE_STATUSES])))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function insertPendingSubscription(
  tx: DbExecutor,
  owner: SubscriptionOwner,
  plan: Pick<Plan, "id" | "kind">,
): Promise<Subscription> {
  const [row] = await tx
    .insert(subscriptions)
    .values({
      ownerUserId: owner.kind === "user" ? owner.userId : null,
      ownerAgencyId: owner.kind === "agency" ? owner.agencyId : null,
      kind: plan.kind,
      planId: plan.id,
      status: "pending",
    })
    .returning();
  return row;
}

/** Only for a never-paid (pending) subscription: the lister picked another plan before paying. */
export async function switchPendingPlan(tx: DbExecutor, subscriptionId: string, planId: string): Promise<void> {
  await tx
    .update(subscriptions)
    .set({ planId })
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.status, "pending")));
}

export async function lockSubscription(tx: DbExecutor, id: string): Promise<Subscription | null> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1).for("update");
  return row ?? null;
}

/** Plan, period and schedule written together when a payment confirms or a downgrade is scheduled. */
export async function updateSubscription(
  tx: DbExecutor,
  id: string,
  values: Partial<
    Pick<
      Subscription,
      "status" | "planId" | "currentPeriodStart" | "currentPeriodEnd" | "graceEndsAt" | "scheduledPlanId" | "scheduledChangeAt"
    >
  >,
): Promise<void> {
  await tx.update(subscriptions).set(values).where(eq(subscriptions.id, id));
}

/** The amount actually paid for the period covering `at`, for the upgrade credit (prompt S6 decision 1). */
export async function paidAmountCovering(db: DbExecutor, subscriptionId: string, at: Date): Promise<number | null> {
  const [row] = await db
    .select({ amountKes: invoices.amountKes })
    .from(invoices)
    .where(
      and(
        eq(invoices.subscriptionId, subscriptionId),
        eq(invoices.status, "paid"),
        lte(invoices.periodStart, at),
        gt(invoices.periodEnd, at),
      ),
    )
    .orderBy(desc(invoices.periodStart))
    .limit(1);
  return row?.amountKes ?? null;
}

export async function openInvoices(tx: DbExecutor, subscriptionId: string): Promise<Invoice[]> {
  return tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.subscriptionId, subscriptionId), eq(invoices.status, "open")))
    .orderBy(desc(invoices.createdAt));
}

export async function voidInvoices(tx: DbExecutor, ids: string[], now: Date): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(invoices)
    .set({ status: "void", voidedAt: now })
    .where(and(inArray(invoices.id, ids), eq(invoices.status, "open")));
}

export async function insertInvoice(
  tx: DbExecutor,
  { subscriptionId, planId, amountKes }: { subscriptionId: string; planId: string; amountKes: number },
): Promise<Invoice> {
  const [row] = await tx.insert(invoices).values({ subscriptionId, planId, amountKes }).returning();
  return row;
}

export async function lockInvoice(tx: DbExecutor, id: string): Promise<Invoice | null> {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1).for("update");
  return row ?? null;
}

export async function findInvoiceByNumber(db: DbExecutor, invoiceNumber: string): Promise<Invoice | null> {
  const [row] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber)).limit(1);
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Payments and events                                                        */
/* -------------------------------------------------------------------------- */

/** A pending STK request for the invoice created after `since` (the in-flight guard). */
export async function hasRecentPendingStk(tx: DbExecutor, invoiceId: string, since: Date): Promise<boolean> {
  const [row] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.invoiceId, invoiceId),
        eq(payments.method, "stk_push"),
        eq(payments.status, "pending"),
        gt(payments.createdAt, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function insertStkPayment(
  db: DbExecutor,
  values: {
    invoiceId: string;
    phoneE164: string;
    checkoutRequestId: string;
    merchantRequestId: string;
    amountKes: number;
  },
): Promise<Payment> {
  const [row] = await db
    .insert(payments)
    .values({ ...values, method: "stk_push", status: "pending" })
    .returning();
  return row;
}

/** Inserts a Paybill payment; null when its receipt (TransID) is already recorded. */
export async function insertC2bPayment(
  tx: DbExecutor,
  values: {
    invoiceId: string;
    phoneE164: string | null;
    mpesaReceipt: string;
    amountKes: number;
    paidAmountKes: number | null;
    rawCallback: unknown;
  },
): Promise<Payment | null> {
  const [row] = await tx
    .insert(payments)
    .values({ ...values, method: "c2b_paybill", status: "pending" })
    .onConflictDoNothing({ target: payments.mpesaReceipt })
    .returning();
  return row ?? null;
}

/** A pending card payment; its reference is our own and unique (prompt S6 decision 16). */
export async function insertCardPayment(
  db: DbExecutor,
  values: { invoiceId: string; providerReference: string; amountKes: number },
): Promise<Payment> {
  const [row] = await db
    .insert(payments)
    .values({ ...values, method: "card", status: "pending" })
    .returning();
  return row;
}

export async function findPaymentByProviderReference(db: DbExecutor, reference: string): Promise<Payment | null> {
  const [row] = await db.select().from(payments).where(eq(payments.providerReference, reference)).limit(1);
  return row ?? null;
}

export async function getPayment(db: DbExecutor, id: string): Promise<Payment | null> {
  const [row] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return row ?? null;
}

export async function lockPayment(tx: DbExecutor, id: string): Promise<Payment | null> {
  const [row] = await tx.select().from(payments).where(eq(payments.id, id)).limit(1).for("update");
  return row ?? null;
}

export async function findPaymentByCheckoutId(db: DbExecutor, checkoutRequestId: string): Promise<Payment | null> {
  const [row] = await db.select().from(payments).where(eq(payments.checkoutRequestId, checkoutRequestId)).limit(1);
  return row ?? null;
}

/** Another payment already holding this receipt, if any. */
export async function paymentWithReceipt(db: DbExecutor, receipt: string, exceptId: string): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.mpesaReceipt, receipt), ne(payments.id, exceptId)))
    .limit(1);
  return row ?? null;
}

/**
 * Stores the first callback on a pending STK payment. Later callbacks change nothing (they are
 * kept as events). The receipt is stored now so a Paybill confirmation for the same money is
 * recognised as a duplicate; if another payment already holds it, the callback is stored without.
 */
export async function storeStkCallback(
  db: DbExecutor,
  paymentId: string,
  values: { raw: unknown; resultCode: number; resultDesc: string; receipt: string | null; paidAmountKes: number | null },
): Promise<boolean> {
  const write = (receipt: string | null) =>
    db
      .update(payments)
      .set({
        rawCallback: values.raw,
        resultCode: values.resultCode,
        resultDesc: values.resultDesc,
        paidAmountKes: values.paidAmountKes,
        ...(receipt ? { mpesaReceipt: receipt } : {}),
      })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending"), isNull(payments.rawCallback)))
      .returning({ id: payments.id });
  const receipt = values.receipt && !(await paymentWithReceipt(db, values.receipt, paymentId)) ? values.receipt : null;
  try {
    return (await write(receipt)).length > 0;
  } catch (error) {
    // A Paybill confirmation took the receipt between the check and the write.
    if (!receipt || !isUniqueViolation(error)) throw error;
    return (await write(null)).length > 0;
  }
}

export async function updatePayment(
  tx: DbExecutor,
  id: string,
  values: Partial<
    Pick<
      Payment,
      | "status"
      | "mpesaReceipt"
      | "paidAmountKes"
      | "flagReason"
      | "confirmedAt"
      | "resultCode"
      | "resultDesc"
      | "cardBrand"
      | "cardLast4"
    >
  >,
): Promise<void> {
  await tx.update(payments).set(values).where(eq(payments.id, id));
}

export type PaymentEventType =
  | "stk_push"
  | "stk_push_failed"
  | "stk_callback"
  | "stk_query"
  | "c2b_validation"
  | "c2b_confirmation"
  | "callback_rejected"
  | "status_change"
  | "card_init"
  | "card_init_failed"
  | "card_webhook"
  | "card_verify"
  | "reconciliation";

export async function recordPaymentEvent(
  db: DbExecutor,
  event: {
    eventType: PaymentEventType;
    paymentId?: string | null;
    invoiceId?: string | null;
    sourceIp?: string | null;
    payload: unknown;
  },
): Promise<void> {
  await db.insert(paymentEvents).values({
    eventType: event.eventType,
    paymentId: event.paymentId ?? null,
    invoiceId: event.invoiceId ?? null,
    sourceIp: event.sourceIp ?? null,
    payload: event.payload ?? {},
  });
}

/** When an event of this type was last recorded for the payment (throttles repeat checks). */
export async function lastEventAt(db: DbExecutor, paymentId: string, eventType: PaymentEventType): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(paymentEvents.createdAt) })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.paymentId, paymentId), eq(paymentEvents.eventType, eventType)));
  return row?.at ?? null;
}

/** The callback result stored on a payment, for the dev simulator's STK Query. */
export async function storedStkResult(
  db: DbExecutor,
  checkoutRequestId: string,
): Promise<{ resultCode: number; resultDesc: string } | null> {
  const [row] = await db
    .select({ resultCode: payments.resultCode, resultDesc: payments.resultDesc })
    .from(payments)
    .where(eq(payments.checkoutRequestId, checkoutRequestId))
    .limit(1);
  return row && row.resultCode !== null ? { resultCode: row.resultCode, resultDesc: row.resultDesc ?? "" } : null;
}

/* -------------------------------------------------------------------------- */
/* Listings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * After a listing plan is paid: return listings that billing paused, newest first, up to the
 * plan's free slots. They were reviewed before they were paused, so they publish directly.
 */
export async function restorePausedListings(
  tx: DbExecutor,
  pool: ListingPool,
  listingLimit: number,
  now: Date,
): Promise<string[]> {
  const owner = pool.kind === "agency" ? eq(properties.agencyId, pool.agencyId) : eq(properties.ownerUserId, pool.userId);
  const candidates = await tx
    .select({ id: properties.id, publishedAt: properties.publishedAt })
    .from(properties)
    .where(
      and(owner, eq(properties.status, "paused"), inArray(properties.pauseReason, [...RESTORABLE_PAUSE_REASONS])),
    )
    .for("update");
  if (candidates.length === 0) return [];

  const slots = remainingSlots(listingLimit, await countActiveListings(tx, pool));
  const keep = pickListingsToKeep(candidates, slots).map((c) => c.id);
  if (keep.length === 0) return [];

  await tx
    .update(properties)
    .set({
      status: "published",
      pausedAt: null,
      pauseReason: null,
      publishedAt: sql`coalesce(${properties.publishedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(and(inArray(properties.id, keep), eq(properties.status, "paused")));
  return keep;
}

/**
 * After a listing plan's grace ends (prompt S9 decision 5): the pool's published listings move to
 * `paused` (`plan_lapsed`) and leave search. Listings in review keep their slot; approval already
 * needs an active plan. Restored by `restorePausedListings` on renewal.
 */
export async function pausePoolListings(tx: DbExecutor, pool: ListingPool, now: Date): Promise<string[]> {
  const owner = pool.kind === "agency" ? eq(properties.agencyId, pool.agencyId) : eq(properties.ownerUserId, pool.userId);
  const live = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(and(owner, eq(properties.status, "published")))
    .for("update");
  if (live.length === 0) return [];
  const paused = await tx
    .update(properties)
    .set({ status: "paused", pausedAt: now, pauseReason: "plan_lapsed" })
    .where(and(inArray(properties.id, live.map((row) => row.id)), eq(properties.status, "published")))
    .returning({ id: properties.id });
  return paused.map((row) => row.id);
}

/* -------------------------------------------------------------------------- */
/* Operator status (scripts)                                                  */
/* -------------------------------------------------------------------------- */

export async function invoiceStatus(db: DbExecutor, invoiceNumber: string) {
  const invoice = await findInvoiceByNumber(db, invoiceNumber);
  if (!invoice) return null;
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, invoice.subscriptionId));
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.invoiceId, invoice.id))
    .orderBy(payments.createdAt);
  return { invoice, subscription, payments: rows };
}
