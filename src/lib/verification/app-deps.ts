import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { withTransaction } from "@/db/tx";
import { getBillingDeps } from "@/lib/billing/app-deps";
import { verificationDecisionEmail, type VerificationEmailKind } from "@/lib/email/templates";
import { getPrivateStore } from "@/lib/storage";
import type { DecisionDeps } from "./decisions";
import type { ListerDeps } from "./lister";

/** The app's verification dependencies (prompt S12). Tests build their own. */
export function getListerDeps(): ListerDeps {
  return { db: getDb(), withTransaction, now: () => new Date(), privateStore: getPrivateStore() };
}

export function getDecisionDeps(): DecisionDeps {
  return { withTransaction, now: () => new Date() };
}

export const VERIFICATION_PATH = "/account/verification";

/**
 * Tells the lister about a decision (decision 11). Sent after the decision commits; a failed email
 * is logged without personal data and never undoes the decision.
 */
export async function notifyLister(
  listerUserId: string,
  kind: VerificationEmailKind,
  details: { reason?: string | null; creditNote?: string | null } = {},
): Promise<void> {
  try {
    const { email, appUrl } = getBillingDeps();
    const [user] = await getDb().select({ name: users.name, email: users.email }).from(users).where(eq(users.id, listerUserId)).limit(1);
    if (!user) return;
    await email({ to: user.email, ...verificationDecisionEmail(user.name, kind, details, `${appUrl}${VERIFICATION_PATH}`) });
  } catch (error) {
    console.error(`[verification] ${kind} email failed`, error instanceof Error ? error.name : "unknown");
  }
}
