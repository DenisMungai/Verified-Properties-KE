import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import {
  billingReminders as br,
  notificationDeliveries as nd,
  subscriptions,
  users,
  verificationReminders as vrem,
  verificationRequests,
} from "@/db/schema";
import { maskEmail } from "@/lib/email/send";
import { DELIVERY_MAX_ATTEMPTS } from "@/lib/notifications/constants";
import { REMINDER_MAX_ATTEMPTS } from "./jobs";

/**
 * The admin Jobs & emails page (prompt S16 decision 12): delivery outcomes across
 * `notification_deliveries`, `billing_reminders` and `verification_reminders`. Recipients leave
 * here already masked; phones are never read.
 */

export type AdminDeliveryKind =
  | "message_alert"
  | "payment_receipt"
  | "review_digest"
  | "renewal_email"
  | "renewal_sms"
  | "rereview_email"
  | "rereview_sms";

export const DELIVERY_KIND_LABELS: Record<AdminDeliveryKind, string> = {
  message_alert: "Message alerts",
  payment_receipt: "Payment receipts",
  review_digest: "Review digests",
  renewal_email: "Renewal reminders (email)",
  renewal_sms: "Renewal reminders (SMS)",
  rereview_email: "Re-review reminders (email)",
  rereview_sms: "Re-review reminders (SMS)",
};

export interface DeliveryCounts {
  sent: number;
  skipped: number;
  failed: number;
  pending: number;
}

export interface FailedDelivery {
  id: string;
  at: Date;
  kind: AdminDeliveryKind;
  /** Masked email, or null for SMS. */
  recipient: string | null;
  attempts: number;
  error: string | null;
  willRetry: boolean;
}

function emptyCounts(): DeliveryCounts {
  return { sent: 0, skipped: 0, failed: 0, pending: 0 };
}

function addCount(target: DeliveryCounts, status: string, n: number): void {
  if (status === "sent" || status === "skipped" || status === "failed" || status === "pending") target[status] += n;
}

/** Outcomes per kind for rows created since `since`. Every kind is present, zeroes included. */
export async function deliverySummary(db: DbExecutor, since: Date): Promise<Map<AdminDeliveryKind, DeliveryCounts>> {
  const n = sql<number>`count(*)::int`;
  const [ours, renewals, rereviews] = await Promise.all([
    db.select({ kind: nd.kind, status: nd.status, n }).from(nd).where(gte(nd.createdAt, since)).groupBy(nd.kind, nd.status),
    db.select({ channel: br.channel, status: br.status, n }).from(br).where(gte(br.createdAt, since)).groupBy(br.channel, br.status),
    db.select({ channel: vrem.channel, status: vrem.status, n }).from(vrem).where(gte(vrem.createdAt, since)).groupBy(vrem.channel, vrem.status),
  ]);
  const summary = new Map<AdminDeliveryKind, DeliveryCounts>(
    (Object.keys(DELIVERY_KIND_LABELS) as AdminDeliveryKind[]).map((kind) => [kind, emptyCounts()]),
  );
  for (const row of ours) {
    const counts = summary.get(row.kind as AdminDeliveryKind);
    if (counts) addCount(counts, row.status, row.n);
  }
  for (const row of renewals) addCount(summary.get(row.channel === "sms" ? "renewal_sms" : "renewal_email")!, row.status, row.n);
  for (const row of rereviews) addCount(summary.get(row.channel === "sms" ? "rereview_sms" : "rereview_email")!, row.status, row.n);
  return summary;
}

/** Failed deliveries updated since `since`, newest first, across all three tables. */
export async function failedDeliveries(db: DbExecutor, since: Date, limit: number): Promise<FailedDelivery[]> {
  const [ours, renewals, rereviews] = await Promise.all([
    db
      .select({ id: nd.id, at: nd.updatedAt, kind: nd.kind, email: users.email, attempts: nd.attempts, error: nd.lastError })
      .from(nd)
      .innerJoin(users, eq(users.id, nd.recipientUserId))
      .where(and(eq(nd.status, "failed"), gte(nd.updatedAt, since)))
      .orderBy(desc(nd.updatedAt))
      .limit(limit),
    db
      .select({ id: br.id, at: br.updatedAt, channel: br.channel, email: users.email, attempts: br.attempts, error: br.lastError })
      .from(br)
      .innerJoin(subscriptions, eq(subscriptions.id, br.subscriptionId))
      .leftJoin(users, eq(users.id, subscriptions.ownerUserId))
      .where(and(eq(br.status, "failed"), gte(br.updatedAt, since)))
      .orderBy(desc(br.updatedAt))
      .limit(limit),
    db
      .select({ id: vrem.id, at: vrem.updatedAt, channel: vrem.channel, email: users.email, attempts: vrem.attempts, error: vrem.lastError })
      .from(vrem)
      .innerJoin(verificationRequests, eq(verificationRequests.id, vrem.requestId))
      .leftJoin(users, eq(users.id, verificationRequests.listerUserId))
      .where(and(eq(vrem.status, "failed"), gte(vrem.updatedAt, since)))
      .orderBy(desc(vrem.updatedAt))
      .limit(limit),
  ]);

  const rows: FailedDelivery[] = [
    ...ours.map((row) => ({
      id: row.id,
      at: row.at,
      kind: row.kind as AdminDeliveryKind,
      recipient: maskEmail(row.email),
      attempts: row.attempts,
      error: row.error,
      willRetry: row.kind !== "review_digest" && row.attempts < DELIVERY_MAX_ATTEMPTS,
    })),
    ...renewals.map((row) => ({
      id: row.id,
      at: row.at,
      kind: (row.channel === "sms" ? "renewal_sms" : "renewal_email") as AdminDeliveryKind,
      recipient: row.channel === "sms" || !row.email ? null : maskEmail(row.email),
      attempts: row.attempts,
      error: row.error,
      willRetry: row.attempts < REMINDER_MAX_ATTEMPTS,
    })),
    ...rereviews.map((row) => ({
      id: row.id,
      at: row.at,
      kind: (row.channel === "sms" ? "rereview_sms" : "rereview_email") as AdminDeliveryKind,
      recipient: row.channel === "sms" || !row.email ? null : maskEmail(row.email),
      attempts: row.attempts,
      error: row.error,
      willRetry: row.attempts < REMINDER_MAX_ATTEMPTS,
    })),
  ];
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
