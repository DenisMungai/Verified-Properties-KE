import "server-only";
import { receiptForPayment, receiptRecipients, type ReceiptData } from "@/db/queries/receipts";
import { maskEmail } from "@/lib/email/send";
import { paymentReceiptEmail } from "@/lib/email/templates";
import { formatKes, formatNairobiDate, formatNairobiDateTime } from "@/lib/format";
import type { BillingDeps } from "./deps";
import { receiptPath } from "./receipt-path";

/**
 * Receipt emails (prompt S6 decision 5). Sent once, after the confirming transaction commits:
 * a replayed callback returns `already_confirmed` and never reaches here. A failed send is logged
 * and never undoes or blocks the confirmation.
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

export async function sendPaymentReceipt(
  deps: Pick<BillingDeps, "db" | "email" | "appUrl">,
  paymentId: string,
): Promise<number> {
  const found = await receiptForPayment(deps.db, paymentId);
  if (!found) return 0;
  const { receipt } = found;
  const recipients = await receiptRecipients(deps.db, found);
  const url = `${deps.appUrl}${receiptPath(receipt.invoiceNumber)}`;
  const details = {
    invoiceNumber: receipt.invoiceNumber,
    planName: receipt.planName,
    period: periodLabel(receipt.periodStart, receipt.periodEnd),
    amount: formatKes(receipt.amountKes),
    paidWith: paidWithLabel(receipt),
    paidAt: formatNairobiDateTime(receipt.paidAt),
  };
  let sent = 0;
  for (const recipient of recipients) {
    try {
      await deps.email({ to: recipient.email, ...paymentReceiptEmail(recipient.name, details, url) });
      sent += 1;
    } catch (error) {
      console.error(
        `[billing] receipt email failed invoice=${receipt.invoiceNumber} to=${maskEmail(recipient.email)}`,
        error instanceof Error ? error.name : "unknown",
      );
    }
  }
  console.info(`[billing] receipt sent invoice=${receipt.invoiceNumber} recipients=${sent}`);
  return sent;
}

/** After a confirmation outcome: send the receipt when, and only when, this call confirmed it. */
export async function receiptAfterConfirm(
  deps: Pick<BillingDeps, "db" | "email" | "appUrl">,
  outcome: { outcome: string; paymentId?: string },
): Promise<void> {
  if (outcome.outcome !== "confirmed" || !outcome.paymentId) return;
  try {
    await sendPaymentReceipt(deps, outcome.paymentId);
  } catch (error) {
    console.error("[billing] receipt email failed", error instanceof Error ? error.name : "unknown");
  }
}
