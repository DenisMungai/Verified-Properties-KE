/**
 * Runs once before the suite (prompt S22, implementation requirement 4): guard, reset the e2e
 * branch from its parent (dev), apply migrations. The admin account is made by admin.setup.ts.
 */
import { e2eDatabaseUrls, loadEnvFiles } from "./support/env";
import { resetE2eBranch } from "./support/neon";
import { runJob, runNodeScript } from "./support/scripts";

export default async function globalSetup(): Promise<void> {
  loadEnvFiles();
  const db = e2eDatabaseUrls();
  console.info(`[e2e] run ${process.env.E2E_RUN_ID} on endpoint ${db.label}`);

  if (process.env.E2E_SKIP_RESET === "yes") {
    console.info("[e2e] E2E_SKIP_RESET=yes: the e2e branch is NOT reset (data from earlier runs stays).");
  } else {
    await resetE2eBranch(db.label);
  }

  runNodeScript("drizzle-kit migrate", ["./node_modules/drizzle-kit/bin.cjs", "migrate"]);
  // Dev never runs background jobs. Settle the branch to the real clock first, so the journey's
  // grace-expiry run (flow 7) changes only the e2e agent's plan.
  runJob("grace-expiry");
}
