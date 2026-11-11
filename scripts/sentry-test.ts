/**
 * Operator: send one test error to Sentry, through the app's own options and scrubber
 * (prompt S21 manual test 6). There is no public route for this.
 *
 *   npm run sentry:test          # needs NEXT_PUBLIC_SENTRY_DSN in .env or .env.local
 *
 * The message carries a made-up email address and phone number. In Sentry both must show masked
 * ("j•••@example.com", "+254 7•• ••• 678").
 */
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "../src/lib/monitoring/sentry-options";

async function main(): Promise<number> {
  const options = sentryOptions();
  if (!options.dsn) {
    console.error("NEXT_PUBLIC_SENTRY_DSN is not set. Copy the DSN from Sentry → Project settings → Client Keys into .env.");
    return 1;
  }
  Sentry.init({ ...options, environment: "sentry-test" });
  const eventId = Sentry.captureException(new Error("S21 Sentry test: contact jane.doe@example.com or 0712345678"));
  const sent = await Sentry.flush(10_000);
  if (!sent) {
    console.error("Sentry did not confirm delivery within 10 seconds. Check the DSN and your connection.");
    return 1;
  }
  console.info(`Sent test event ${eventId}. In Sentry the message should read "contact j•••@example.com or +254 7•• ••• 678".`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("sentry-test failed:", error instanceof Error ? error.name : "unknown");
    process.exit(1);
  },
);
