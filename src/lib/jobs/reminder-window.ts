import { DAY_MS } from "@/lib/billing/constants";

/**
 * Which renewal reminder is due (plan v2.0 §4; prompt S9 decision 7). Pure.
 * - "5d" while more than 1 day and at most 5 days are left
 * - "1d" inside the last day
 * A job that missed the 5-day window sends only the 1-day reminder, never both at once.
 */

export const REMINDER_LEAD_DAYS = 5;

export type DueReminder = "5d" | "1d";

export function reminderDue(periodEnd: Date, now: Date): DueReminder | null {
  const left = periodEnd.getTime() - now.getTime();
  if (left <= 0 || left > REMINDER_LEAD_DAYS * DAY_MS) return null;
  return left <= DAY_MS ? "1d" : "5d";
}
