/**
 * Operator: register the Paybill (C2B) validation and confirmation URLs with Daraja. Needs Daraja
 * credentials. In production it also needs MPESA_REGISTER_CONFIRM=yes, and Safaricom allows the
 * URLs to be registered once (changes go through the M-PESA Org portal).
 *
 *   npm run mpesa:register-c2b [-- --shortcode 600xxx]   (sandbox C2B uses a test short code)
 */
import { callbackUrl, CALLBACK_PATHS, mpesaSettingsFor } from "../src/lib/mpesa/config";
import { createDarajaClient } from "../src/lib/mpesa/daraja";
import { parseServerEnv } from "../src/lib/env";
import { parseArgs, run } from "./lib/mpesa-script";

run("mpesa-register-c2b", async () => {
  const env = parseServerEnv(process.env);
  const settings = mpesaSettingsFor(env);
  if (!settings || settings.mode !== "daraja" || !settings.credentials) {
    console.error("Daraja is not configured: set the MPESA_* credentials and MPESA_CALLBACK_TOKEN.");
    return 1;
  }
  if (settings.environment === "production" && process.env.MPESA_REGISTER_CONFIRM !== "yes") {
    console.error("Refusing to register production URLs: set MPESA_REGISTER_CONFIRM=yes.");
    return 1;
  }
  const { flags } = parseArgs(process.argv.slice(2));
  const shortcode = flags.shortcode ?? settings.shortcode;
  if (!/^\d{5,7}$/.test(shortcode)) {
    console.error("The short code must be 5-7 digits.");
    return 1;
  }

  const client = createDarajaClient({ baseUrl: settings.baseUrl, shortcode, ...settings.credentials });
  const result = await client.registerC2bUrls({
    validationUrl: callbackUrl(settings, CALLBACK_PATHS.c2bValidation),
    confirmationUrl: callbackUrl(settings, CALLBACK_PATHS.c2bConfirmation),
    responseType: "Completed",
  });
  if (!result.ok) {
    console.error(`Registration failed: ${result.error}`);
    return 1;
  }
  // The URLs contain the secret token, so print only the base.
  console.info(`Registered C2B URLs for short code ${shortcode} under ${settings.callbackBaseUrl}/api/payments/c2b/…`);
  return 0;
});
