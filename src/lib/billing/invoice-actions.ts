import "server-only";
import type { DbExecutor } from "@/db/executor";
import { getListingPool, type ListingPool } from "@/db/queries/billing";
import {
  cancelPendingSubscription,
  hideInvoiceForLister,
  invoicePaymentFacts,
  isAgencyAdmin,
  lockPoolListingInvoice,
  lockSubscription,
  openInvoices,
  recordPaymentEvent,
  voidInvoices,
} from "@/db/queries/payments";
import type { BillingDeps } from "./deps";
import { canHideInvoice, paymentInProgress } from "./invoice-rules";

/**
 * A lister cancels an unpaid listing-plan invoice, or removes a void one from their list (prompt
 * billing-cancel-delete-invoices). Cancelling voids the invoice, so a later payment against it is
 * flagged by the confirm path and never activates anything. Removing only hides it from the lister.
 */

type Deps = Pick<BillingDeps, "withTransaction" | "now">;

export type InvoiceActionCode = "not_found" | "forbidden" | "not_cancellable" | "in_progress" | "not_deletable";

export type CancelInvoiceResult = { ok: true; subscriptionCancelled: boolean } | { ok: false; code: InvoiceActionCode };
export type HideInvoiceResult = { ok: true } | { ok: false; code: InvoiceActionCode };

/** Agency pools are managed by their admins only. */
async function managedPool(tx: DbExecutor, userId: string): Promise<ListingPool | null> {
  const pool = await getListingPool(tx, userId);
  if (pool.kind === "agency" && !(await isAgencyAdmin(tx, userId, pool.agencyId))) return null;
  return pool;
}

export async function cancelInvoice(deps: Deps, userId: string, invoiceNumber: string): Promise<CancelInvoiceResult> {
  const now = deps.now();
  return deps.withTransaction(async (tx): Promise<CancelInvoiceResult> => {
    const pool = await managedPool(tx, userId);
    if (!pool) return { ok: false, code: "forbidden" };
    const invoice = await lockPoolListingInvoice(tx, pool, invoiceNumber);
    if (!invoice) return { ok: false, code: "not_found" };
    if (invoice.status === "void") return { ok: true, subscriptionCancelled: false };
    if (invoice.status !== "open") return { ok: false, code: "not_cancellable" };
    if (paymentInProgress(await invoicePaymentFacts(tx, invoice.id), now)) return { ok: false, code: "in_progress" };

    await voidInvoices(tx, [invoice.id], now);
    // Lock before reading open invoices so a checkout can't add one between the read and the update.
    const sub = await lockSubscription(tx, invoice.subscriptionId);
    const subscriptionCancelled =
      sub?.status === "pending" && (await openInvoices(tx, sub.id)).length === 0
        ? await cancelPendingSubscription(tx, sub.id, now)
        : false;
    await recordPaymentEvent(tx, {
      eventType: "invoice_cancelled",
      invoiceId: invoice.id,
      payload: { by: "lister", subscriptionCancelled },
    });
    return { ok: true, subscriptionCancelled };
  });
}

export async function hideInvoice(deps: Deps, userId: string, invoiceNumber: string): Promise<HideInvoiceResult> {
  const now = deps.now();
  return deps.withTransaction(async (tx): Promise<HideInvoiceResult> => {
    const pool = await managedPool(tx, userId);
    if (!pool) return { ok: false, code: "forbidden" };
    const invoice = await lockPoolListingInvoice(tx, pool, invoiceNumber);
    if (!invoice) return { ok: false, code: "not_found" };
    if (invoice.listerHiddenAt) return { ok: true };
    if (!canHideInvoice(invoice.status, await invoicePaymentFacts(tx, invoice.id))) return { ok: false, code: "not_deletable" };
    await hideInvoiceForLister(tx, invoice.id, now);
    return { ok: true };
  });
}
