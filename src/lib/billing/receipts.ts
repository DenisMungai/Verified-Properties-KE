import "server-only";
import { receiptForPayment, receiptRecipients, type ReceiptData } from "@/db/queries/receipts";
import { claimDelivery, finishDelivery } from "@/db/queries/notification-deliveries";
import { maskEmail } from "@/lib/email/send";
import { paymentReceiptEmail, type PaymentReceiptDetails } from "@/lib/email/templates";
import { errorName } from "@/lib/log";
import { formatKes, formatNairobiDate, formatNairobiDateTime } from "@/lib/format";
import type { BillingDeps } from "./deps";
import { receiptPath } from "./receipt-path";

/**
 * Receipt emails (prompt S6 decision 5). Sent once, after the confirming transaction commits:
 * a replayed callback returns `already_confirmed` and never reaches here, and the delivery row is
 * a second guard (prompt S16 decision 5). A failed send is recorded and retried, and never undoes
 * or blocks the confirmation.
 */

const CARD_BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", verve: "Verve", "american express": "Amex" };

export function cardBrandLabel(brand: string | null): string {
  if (!brand) return "Card";
  return CARD_BRANDS[brand.trim().toLowerCase()] ?? brand.trim();
}

/** "M-Pesa QAB12CD34E", "Visa •••• 4081" or "Card". */
export function paidWithLabel(receipt: Pick<ReceiptData, "method" | "mpesaReceipt" | "cardBrand" | "cardLast4">): string {
  if (receipt.method === "card") {
    const brand = cardBrandLabel(receipt.cardBrand);
    return receipt.cardLast4 ? `${brand} •••• ${receipt.cardLast4}` : brand;
  }
  return receipt.mpesaReceipt ? `M-Pesa ${receipt.mpesaReceipt}` : "M-Pesa";
}

export function periodLabel(start: Date, end: Date): string {
  return `${formatNairobiDate(start)} – ${formatNairobiDate(end)}`;
}

type ReceiptDeps = Pick<BillingDeps, "db" | "email" | "appUrl" | "now">;

interface ReceiptEmail {
  invoiceNumber: string;
  url: string;
  details: PaymentReceiptDetails;
}

async function loadReceipt(deps: ReceiptDeps, paymentId: string) {
  const found = await receiptForPayment(deps.db, paymentId);
  if (!found) return null;
  const { receipt } = found;
  const email: ReceiptEmail = {
    invoiceNumber: receipt.invoiceNumber,
    url: `${deps.appUrl}${receiptPath(receipt.invoiceNumber)}`,
    details: {
      invoiceNumber: receipt.invoiceNumber,
      planName: receipt.planName,
      period: periodLabel(receipt.periodStart, receipt.periodEnd),
      amount: formatKes(receipt.amountKes),
      paidWith: paidWithLabel(receipt),
      paidAt: formatNairobiDateTime(receipt.paidAt),
    },
  };
  return { email, recipients: await receiptRecipients(deps.db, found) };
}

/** Sends one recipient's receipt and records the outcome on its (already claimed) delivery row. */
async function deliverReceipt(
  deps: ReceiptDeps,
  paymentId: string,
  receipt: ReceiptEmail,
  recipient: { userId: string; email: string; name: string },
): Promise<boolean> {
  const key = { kind: "payment_receipt", ref: paymentId, recipientUserId: recipient.userId } as const;
  try {
    await deps.email({ to: recipient.email, ...paymentReceiptEmail(recipient.name, receipt.details, receipt.url) });
  } catch (error) {
    const name = errorName(error);
    console.error(`[billing] receipt email failed invoice=${receipt.invoiceNumber} to=${maskEmail(recipient.email)}`, name);
    await finishDelivery(deps.db, key, { status: "failed", error: name, now: deps.now() });
    return false;
  }
  await finishDelivery(deps.db, key, { status: "sent", now: deps.now() });
  return true;
}

/**
 * Sends the receipt to each recipient not already handled (prompt S16 decision 5). Each one is
 * claimed in `notification_deliveries` first, so a second call sends nothing; a failure is
 * recorded and retried by the `notifications` job.
 */
export async function sendPaymentReceipt(deps: ReceiptDeps, paymentId: string): Promise<number> {
  const loaded = await loadReceipt(deps, paymentId);
  if (!loaded) return 0;
  let sent = 0;
  for (const recipient of loaded.recipients) {
    const claimed = await claimDelivery(deps.db, { kind: "payment_receipt", ref: paymentId, recipientUserId: recipient.userId }, deps.now());
    if (claimed && (await deliverReceipt(deps, paymentId, loaded.email, recipient))) sent += 1;
  }
  console.info(`[billing] receipt sent invoice=${loaded.email.invoiceNumber} recipients=${sent}`);
  return sent;
}

/**
 * A retry from the `notifications` job, whose delivery row is already reclaimed. Skipped when the
 * payment is no longer a paid receipt or the user is no longer a recipient.
 */
export async function resendPaymentReceipt(deps: ReceiptDeps, paymentId: string, recipientUserId: string): Promise<"sent" | "failed" | "skipped"> {
  const loaded = await loadReceipt(deps, paymentId);
  const recipient = loaded?.recipients.find((r) => r.userId === recipientUserId);
  if (!loaded || !recipient) {
    await finishDelivery(deps.db, { kind: "payment_receipt", ref: paymentId, recipientUserId }, { status: "skipped", error: "not_found", now: deps.now() });
    return "skipped";
  }
  return (await deliverReceipt(deps, paymentId, loaded.email, recipient)) ? "sent" : "failed";
}

/** After a confirmation outcome: send the receipt when, and only when, this call confirmed it. */
export async function receiptAfterConfirm(deps: ReceiptDeps, outcome: { outcome: string; paymentId?: string }): Promise<void> {
  if (outcome.outcome !== "confirmed" || !outcome.paymentId) return;
  try {
    await sendPaymentReceipt(deps, outcome.paymentId);
  } catch (error) {
    console.error("[billing] receipt email failed", errorName(error));
  }
}
