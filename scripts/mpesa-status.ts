/**
 * Dev / operator: print an invoice, its payments and its subscription period.
 *
 *   npm run mpesa:status -- VPK0000012
 */
import { invoiceStatus } from "../src/db/queries/payments";
import { formatNairobiDateTime } from "../src/lib/format";
import { maskPhone } from "../src/lib/kenya";
import { openScriptContext, parseArgs, run } from "./lib/mpesa-script";

const when = (date: Date | null) => (date ? formatNairobiDateTime(date) : "-");

run("mpesa-status", async () => {
  const [invoiceNumber] = parseArgs(process.argv.slice(2)).positional;
  if (!invoiceNumber) {
    console.error("Usage: npm run mpesa:status -- <invoice number, e.g. VPK0000012>");
    return 1;
  }
  const ctx = openScriptContext();
  try {
    const status = await invoiceStatus(ctx.db, invoiceNumber.trim().toUpperCase());
    if (!status) {
      console.error(`No invoice ${invoiceNumber}.`);
      return 1;
    }
    const { invoice, subscription, payments } = status;
    console.info("Invoice");
    console.table({
      number: invoice.invoiceNumber,
      status: invoice.status,
      amountKes: invoice.amountKes,
      period: `${when(invoice.periodStart)} → ${when(invoice.periodEnd)}`,
      paidAt: when(invoice.paidAt),
    });
    console.info("Payments");
    console.table(
      payments.map((p) => ({
        method: p.method,
        status: p.status,
        receipt: p.mpesaReceipt ?? "-",
        amountKes: p.amountKes,
        paidKes: p.paidAmountKes ?? "-",
        result: p.resultCode ?? "-",
        flag: p.flagReason ?? "-",
        phone: p.phoneE164 ? maskPhone(p.phoneE164) : "-",
        checkout: p.checkoutRequestId ?? "-",
      })),
    );
    console.info("Subscription");
    console.table({
      status: subscription.status,
      periodStart: when(subscription.currentPeriodStart),
      periodEnd: when(subscription.currentPeriodEnd),
      graceEnds: when(subscription.graceEndsAt),
    });
    return 0;
  } finally {
    await ctx.close();
  }
});
