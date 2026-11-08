import "server-only";
import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { notificationDeliveries as nd } from "@/db/schema";
import {
  DELIVERY_MAX_ATTEMPTS,
  DELIVERY_RETENTION_DAYS,
  MINUTE_MS,
  RETRY_BACKOFF_MIN,
  STUCK_PENDING_MIN,
  type DeliveryKind,
  type DeliveryStatus,
} from "@/lib/notifications/constants";

/**
 * Delivery bookkeeping (prompt S16 decisions 3–5). A sender claims the row first; only the
 * claimer sends. Retries reclaim a failed row (after its backoff) or an abandoned `pending` one,
 * while attempts remain. `updated_at` is always set from the caller's clock so backoff is testable.
 */

export interface DeliveryKey {
  kind: DeliveryKind;
  ref: string;
  recipientUserId: string;
}

function keyCondition(key: DeliveryKey) {
  return and(eq(nd.kind, key.kind), eq(nd.ref, key.ref), eq(nd.recipientUserId, key.recipientUserId), eq(nd.channel, "email"));
}

/** True when this caller now owns a brand-new send. An existing row (any status) is left alone. */
export async function claimDelivery(db: DbExecutor, key: DeliveryKey, now: Date): Promise<boolean> {
  const inserted = await db
    .insert(nd)
    .values({ ...key, channel: "email", status: "pending", createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: [nd.kind, nd.ref, nd.recipientUserId, nd.channel] })
    .returning({ id: nd.id });
  return inserted.length > 0;
}

/** Retry condition: failed past its backoff, or pending long enough to be abandoned. */
function retryable(now: Date) {
  const stuckBefore = new Date(now.getTime() - STUCK_PENDING_MIN * MINUTE_MS);
  return and(
    lt(nd.attempts, DELIVERY_MAX_ATTEMPTS),
    or(
      and(
        eq(nd.status, "failed"),
        lte(nd.updatedAt, sql`${now.toISOString()}::timestamptz - make_interval(mins => ${RETRY_BACKOFF_MIN} * ${nd.attempts})`),
      ),
      and(eq(nd.status, "pending"), lte(nd.updatedAt, stuckBefore)),
    ),
  );
}

/** True when this caller reclaimed a due row for another attempt. */
export async function reclaimDelivery(db: DbExecutor, key: DeliveryKey, now: Date): Promise<boolean> {
  const reclaimed = await db
    .update(nd)
    .set({ status: "pending", attempts: sql`${nd.attempts} + 1`, lastError: null, updatedAt: now })
    .where(and(keyCondition(key), retryable(now)))
    .returning({ id: nd.id });
  return reclaimed.length > 0;
}

export async function finishDelivery(
  db: DbExecutor,
  key: DeliveryKey,
  { status, error, now }: { status: DeliveryStatus; error?: string; now: Date },
): Promise<void> {
  await db
    .update(nd)
    .set({ status, lastError: error ? error.slice(0, 100) : null, sentAt: status === "sent" ? now : null, updatedAt: now })
    .where(and(keyCondition(key), eq(nd.status, "pending")));
}

/** Message alerts and receipts due another try, oldest first. Digests aren't retried. */
export async function retryableDeliveries(db: DbExecutor, now: Date, limit: number): Promise<DeliveryKey[]> {
  const rows = await db
    .select({ kind: nd.kind, ref: nd.ref, recipientUserId: nd.recipientUserId })
    .from(nd)
    .where(and(inArray(nd.kind, ["message_alert", "payment_receipt"]), retryable(now)))
    .orderBy(asc(nd.updatedAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, kind: row.kind as DeliveryKind }));
}

/** Rows older than the retention window, whatever their status. */
export async function pruneDeliveries(db: DbExecutor, now: Date): Promise<number> {
  const before = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 24 * 60 * MINUTE_MS);
  const deleted = await db.delete(nd).where(lt(nd.createdAt, before)).returning({ id: nd.id });
  return deleted.length;
}
