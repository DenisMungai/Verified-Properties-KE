/**
 * Dev / operator: start an M-Pesa payment for a lister's plan, exactly as the app's Server Action
 * does (same rate limits, same rules). Sandbox or simulator only; never real money.
 *
 *   MPESA_PAY_CONFIRM=yes npm run mpesa:pay -- --email you@example.com --plan starter --phone 0712345678
 *   PowerShell: $env:MPESA_PAY_CONFIRM="yes"; npm run mpesa:pay -- --email ... --plan starter --phone 07...
 */
import { eq } from "drizzle-orm";
import { users } from "../src/db/schema";
import { maskEmail } from "../src/lib/email/send";
import { startPlanPayment } from "../src/lib/mpesa/start-payment";
import { openScriptContext, parseArgs, run, scriptPaymentDeps } from "./lib/mpesa-script";

run("mpesa-pay", async () => {
  if (process.env.MPESA_PAY_CONFIRM !== "yes") {
    console.error("Refusing to run: set MPESA_PAY_CONFIRM=yes to confirm this is a test payment.");
    return 1;
  }
  if (process.env.MPESA_ENV === "production") {
    console.error("Refusing to run with MPESA_ENV=production: scripts never start real payments.");
    return 1;
  }
  const { flags } = parseArgs(process.argv.slice(2));
  if (!flags.email || !flags.plan || !flags.phone) {
    console.error("Usage: npm run mpesa:pay -- --email <email> --plan <starter|pro|agency> --phone <07...>");
    return 1;
  }

  const ctx = openScriptContext();
  try {
    const deps = scriptPaymentDeps(ctx);
    if (!deps) {
      console.error("M-Pesa is not set up: set MPESA_CALLBACK_TOKEN (and Daraja credentials for the sandbox).");
      return 1;
    }
    const [user] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, flags.email.trim().toLowerCase()))
      .limit(1);
    if (!user) {
      console.error(`No user with email ${maskEmail(flags.email)}.`);
      return 1;
    }

    console.info(`Client: ${deps.daraja.kind} (${deps.settings.environment})`);
    const result = await startPlanPayment(deps, { userId: user.id, planCode: flags.plan, phone: flags.phone });
    if (!result.ok) {
      console.error(`Not started (${result.code}): ${result.message}`);
      return 1;
    }
    console.table({
      invoice: result.invoiceNumber,
      plan: result.planName,
      amountKes: result.amountKes,
      paybill: result.paybill,
      checkoutRequestId: result.checkoutRequestId,
    });
    console.info(
      deps.daraja.kind === "simulator"
        ? `Next: npm run mpesa:simulate -- --checkout ${result.checkoutRequestId}`
        : "Next: enter your M-Pesa PIN on the phone, then watch the dev server terminal.",
    );
    console.info(`Status: npm run mpesa:status -- ${result.invoiceNumber}`);
    return 0;
  } finally {
    await ctx.close();
  }
});
