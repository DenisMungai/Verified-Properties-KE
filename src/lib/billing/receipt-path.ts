/** Where a paid invoice's printable receipt lives (client-safe). */
export function receiptPath(invoiceNumber: string): string {
  return `/account/billing/receipts/${encodeURIComponent(invoiceNumber)}`;
}

export const CHECKOUT_PATH = "/account/billing/checkout";

export function checkoutPath(planCode?: string): string {
  return planCode ? `${CHECKOUT_PATH}?plan=${encodeURIComponent(planCode)}` : CHECKOUT_PATH;
}
