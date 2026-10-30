import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencyMembers, billingReminders, listerProfiles, users } from "@/db/schema";
import { REMINDER_MAX_ATTEMPTS } from "./jobs";

/**
 * Renewal reminder bookkeeping (prompt S9 decision 8). A sender claims the row first; only the
 * claimer sends. A row stuck in `pending` (the process died mid-send) is never resent: a missed
 * reminder is better than a duplicate.
 */

export type ReminderKind = "5d" | "1d";
export type ReminderChannel = "email" | "sms";
export type ReminderStatus = "sent" | "failed" | "skipped";

export interface ReminderKey {
  subscriptionId: string;
  periodEnd: Date;
  reminder: ReminderKind;
  channel: ReminderChannel;
}

function keyCondition(key: ReminderKey) {
  return and(
    eq(billingReminders.subscriptionId, key.subscriptionId),
    eq(billingReminders.periodEnd, key.periodEnd),
    eq(billingReminders.reminder, key.reminder),
    eq(billingReminders.channel, key.channel),
  );
}

/** True when this caller now owns the send: a new row, or a failed one with attempts left. */
export async function claimReminder(db: DbExecutor, key: ReminderKey): Promise<boolean> {
  const inserted = await db
    .insert(billingReminders)
    .values({ ...key, status: "pending" })
    .onConflictDoNothing({
      target: [billingReminders.subscriptionId, billingReminders.periodEnd, billingReminders.reminder, billingReminders.channel],
    })
    .returning({ id: billingReminders.id });
  if (inserted.length > 0) return true;
  const reclaimed = await db
    .update(billingReminders)
    .set({ status: "pending", attempts: sql`${billingReminders.attempts} + 1`, lastError: null })
    .where(and(keyCondition(key), eq(billingReminders.status, "failed"), lt(billingReminders.attempts, REMINDER_MAX_ATTEMPTS)))
    .returning({ id: billingReminders.id });
  return reclaimed.length > 0;
}

export async function finishReminder(
  db: DbExecutor,
  key: ReminderKey,
  { status, error, now }: { status: ReminderStatus; error?: string; now: Date },
): Promise<void> {
  await db
    .update(billingReminders)
    .set({ status, lastError: error ? error.slice(0, 100) : null, sentAt: status === "sent" ? now : null })
    .where(and(keyCondition(key), eq(billingReminders.status, "pending")));
}

export interface ReminderRecipient {
  email: string;
  name: string;
  /** E.164 from the lister profile, when set. */
  phone: string | null;
}

/** The owner, or every admin of the owning agency (the same people who get receipts). */
export async function reminderRecipients(
  db: DbExecutor,
  owner: { ownerUserId: string | null; ownerAgencyId: string | null },
): Promise<ReminderRecipient[]> {
  const columns = { email: users.email, name: users.name, phone: listerProfiles.phone };
  if (owner.ownerUserId) {
    return db
      .select(columns)
      .from(users)
      .leftJoin(listerProfiles, eq(listerProfiles.userId, users.id))
      .where(eq(users.id, owner.ownerUserId));
  }
  if (!owner.ownerAgencyId) return [];
  return db
    .select(columns)
    .from(agencyMembers)
    .innerJoin(users, eq(users.id, agencyMembers.userId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, users.id))
    .where(and(eq(agencyMembers.agencyId, owner.ownerAgencyId), eq(agencyMembers.role, "admin")));
}
