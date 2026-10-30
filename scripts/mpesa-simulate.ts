/**
 * Dev only: post a realistic Daraja STK callback to the running dev server, so the token check,
 * parsing, STK Query (simulated) and confirmation all run for real. Refuses unless the simulator
 * is active (no Daraja credentials, not production).
 *
 *   npm run mpesa:simulate -- --checkout ws_CO_SIM_... [--result success|cancelled|insufficient]
 *                             [--amount <kes>] [--receipt <code>]
 */
import { randomBytes } from "node:crypto";
import { findPaymentByCheckoutId, getPayment } from "../src/db/queries/payments";
import { callbackUrl, CALLBACK_PATHS, mpesaSettingsFor } from "../src/lib/mpesa/config";
import { SIMULATED_CHECKOUT_PREFIX } from "../src/lib/mpesa/simulator";
import { openScriptContext, parseArgs, run } from "./lib/mpesa-script";

const RESULTS = {
  success: { code: 0, desc: "The service request is processed successfully." },
  cancelled: { code: 1032, desc: "Request cancelled by user" },
  insufficient: { code: 1, desc: "The balance is insufficient for the transaction" },
} as const;

function randomReceipt(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  return `SIM${Array.from(randomBytes(7), (b) => alphabet[b % alphabet.length]).join("")}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

run("mpesa-simulate", async () => {
  const { flags } = parseArgs(process.argv.slice(2));
  const resultName = (flags.result ?? "success") as keyof typeof RESULTS;
  if (!flags.checkout?.startsWith(SIMULATED_CHECKOUT_PREFIX) || !(resultName in RESULTS)) {
    console.error(
      "Usage: npm run mpesa:simulate -- --checkout ws_CO_SIM_... [--result success|cancelled|insufficient] [--amount <kes>] [--receipt <code>]",
    );
    return 1;
  }

  const ctx = openScriptContext();
  try {
    const settings = mpesaSettingsFor(ctx.env);
    if (!settings || settings.mode !== "simulator") {
      console.error("The simulator is not active: it needs MPESA_CALLBACK_TOKEN and no Daraja credentials.");
      return 1;
    }
    const payment = await findPaymentByCheckoutId(ctx.db, flags.checkout);
    if (!payment) {
      console.error("No payment with that checkout id. Start one with npm run mpesa:pay.");
      return 1;
    }

    const result = RESULTS[resultName];
    const amount = flags.amount ? Number(flags.amount) : payment.amountKes;
    const receipt = flags.receipt ?? randomReceipt();
    const stkCallback: Record<string, unknown> = {
      MerchantRequestID: payment.merchantRequestId ?? "SIM",
      CheckoutRequestID: payment.checkoutRequestId,
      ResultCode: result.code,
      ResultDesc: result.desc,
    };
    if (result.code === 0) {
      stkCallback.CallbackMetadata = {
        Item: [
          { Name: "Amount", Value: amount },
          { Name: "MpesaReceiptNumber", Value: receipt },
          { Name: "Balance" },
          { Name: "TransactionDate", Value: 20261029120000 },
          { Name: "PhoneNumber", Value: Number((payment.phoneE164 ?? "+254700000000").slice(1)) },
        ],
      };
    }

    // The simulator posts to the local dev server, whatever the public callback base URL is.
    const url = callbackUrl({ ...settings, callbackBaseUrl: ctx.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "") }, CALLBACK_PATHS.stk);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Body: { stkCallback } }),
    });
    console.info(`Callback ${resultName}${result.code === 0 ? ` receipt=${receipt} amount=${amount}` : ""} -> HTTP ${res.status}`);
    if (!res.ok) return 1;

    // Settlement runs after the response; wait briefly for it.
    for (let i = 0; i < 10; i++) {
      await wait(500);
      const current = await getPayment(ctx.db, payment.id);
      if (current && current.status !== "pending") {
        console.info(`Payment ${current.status}${current.flagReason ? ` (${current.flagReason})` : ""}.`);
        return 0;
      }
    }
    console.info("Payment still pending (a repeated callback changes nothing). Check the dev server terminal.");
    return 0;
  } finally {
    await ctx.close();
  }
});
