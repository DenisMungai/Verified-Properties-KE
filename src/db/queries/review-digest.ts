import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { properties as p, userRoles, users, verificationRequests as vr } from "@/db/schema";

/** Moderators' review-queue digest (prompt S16 decision 6): counts and oldest waits only. */

export interface OverdueQueue {
  count: number;
  oldest: Date | null;
}

const overdue = (column: typeof p.updatedAt | typeof vr.submittedAt) => ({
  count: sql<number>`count(*)::int`,
  oldest: sql<string | null>`min(${column})`,
});

function toQueue(row: { count: number; oldest: string | Date | null } | undefined): OverdueQueue {
  if (!row || row.count === 0 || !row.oldest) return { count: 0, oldest: null };
  return { count: row.count, oldest: new Date(row.oldest) };
}

/** Listings in `pending_review` and verification requests `under_review` since before `before`. */
export async function overdueReviewQueues(db: DbExecutor, before: Date): Promise<{ listings: OverdueQueue; verifications: OverdueQueue }> {
  const [[listings], [verifications]] = await Promise.all([
    db.select(overdue(p.updatedAt)).from(p).where(and(eq(p.status, "pending_review"), lte(p.updatedAt, before))),
    db.select(overdue(vr.submittedAt)).from(vr).where(and(eq(vr.status, "under_review"), lte(vr.submittedAt, before))),
  ]);
  return { listings: toQueue(listings), verifications: toQueue(verifications) };
}

/** Platform admins with a verified email: the people who can act on both queues. */
export async function reviewDigestRecipients(db: DbExecutor): Promise<{ userId: string; email: string; name: string }[]> {
  return db
    .select({ userId: users.id, email: users.email, name: users.name })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.role, "platform_admin"), eq(users.emailVerified, true)));
}
