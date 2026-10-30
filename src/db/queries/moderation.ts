import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { agencies, listerProfiles, listingModerationLog, listingReports, properties, propertyImages, users } from "@/db/schema";
import { subscriptionPhase, type SubscriptionPhase } from "@/lib/billing/periods";
import { getListingPool, getListingSubscription } from "./billing";
import { editorColumns, type EditableListing } from "./listings";
import { OPEN_REPORT_STATUSES } from "./reports";

/**
 * Admin moderation (prompt S8 decisions 3, 4 and 12). Callers check `platform_admin` first; the
 * admin id always comes from the session. Every decision locks its row, guards the status in the
 * `where`, and writes the append-only `listing_moderation_log` in the same transaction.
 */

const p = properties;
const r = listingReports;
const log = listingModerationLog;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ModerationAction = "approve" | "reject" | "take_down" | "dismiss_report";

export type DecisionResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "conflict" | "plan_inactive" };

const NOT_FOUND = { ok: false, reason: "not_found" } as const;
const CONFLICT = { ok: false, reason: "conflict" } as const;

const listerName = sql<string>`coalesce(${agencies.name}, ${listerProfiles.displayName}, ${users.name})`;

export interface AdminCounts {
  published: number;
  pending: number;
  openReports: number;
}

export async function adminCounts(db: DbExecutor): Promise<AdminCounts> {
  const [row] = await db
    .select({
      published: sql<number>`(select count(*)::int from ${p} where ${p.status} = 'published')`,
      pending: sql<number>`(select count(*)::int from ${p} where ${p.status} = 'pending_review')`,
      openReports: sql<number>`(select count(*)::int from ${r} where ${r.status} in ('open', 'reviewing'))`,
    })
    .from(sql`(select 1) as one`);
  return row ?? { published: 0, pending: 0, openReports: 0 };
}

/** Listings waiting for review, oldest first. */
export async function moderationQueue(db: DbExecutor) {
  return db
    .select({
      id: p.id,
      title: p.title,
      listerName,
      submittedAt: p.updatedAt,
      everPublished: sql<boolean>`${p.publishedAt} is not null`,
    })
    .from(p)
    .innerJoin(users, eq(users.id, p.ownerUserId))
    .leftJoin(agencies, eq(agencies.id, p.agencyId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, p.ownerUserId))
    .where(eq(p.status, "pending_review"))
    .orderBy(asc(p.updatedAt), asc(p.id))
    .limit(200);
}

export type QueueRow = Awaited<ReturnType<typeof moderationQueue>>[number];

/** The phase of the plan that pays for this owner's listings, or "none". */
export async function listingPlanPhase(db: DbExecutor, ownerUserId: string, now: Date): Promise<SubscriptionPhase | "none"> {
  const plan = await getListingSubscription(db, await getListingPool(db, ownerUserId), now);
  return plan ? subscriptionPhase(plan.subscription, now) : "none";
}

export interface ReviewListing {
  listing: EditableListing;
  lister: { accountName: string; email: string; displayName: string | null; agencyName: string | null };
  photos: { storageKey: string; altText: string }[];
  planPhase: SubscriptionPhase | "none";
}

/** Any listing, for an admin: the editor fields, the lister, photos and plan status. */
export async function getListingForReview(db: DbExecutor, id: string, now = new Date()): Promise<ReviewListing | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select({
      ...editorColumns,
      accountName: users.name,
      email: users.email,
      displayName: listerProfiles.displayName,
      agencyName: agencies.name,
    })
    .from(p)
    .innerJoin(users, eq(users.id, p.ownerUserId))
    .leftJoin(agencies, eq(agencies.id, p.agencyId))
    .leftJoin(listerProfiles, eq(listerProfiles.userId, p.ownerUserId))
    .where(eq(p.id, id))
    .limit(1);
  if (!row) return null;
  const { accountName, email, displayName, agencyName, ...listing } = row;
  const [photos, planPhase] = await Promise.all([
    db
      .select({ storageKey: propertyImages.storageKey, altText: propertyImages.altText })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, id))
      .orderBy(desc(propertyImages.isCover), asc(propertyImages.sortOrder), asc(propertyImages.createdAt)),
    listingPlanPhase(db, listing.ownerUserId, now),
  ]);
  return { listing, lister: { accountName, email, displayName, agencyName }, photos, planPhase };
}

export async function moderationHistory(db: DbExecutor, propertyId: string) {
  return db
    .select({ id: log.id, action: log.action, reason: log.reason, createdAt: log.createdAt, actorName: users.name })
    .from(log)
    .leftJoin(users, eq(users.id, log.actorUserId))
    .where(eq(log.propertyId, propertyId))
    .orderBy(desc(log.createdAt), desc(log.id));
}

async function lockListing(tx: DbExecutor, id: string) {
  const [row] = await tx
    .select({ status: p.status, ownerUserId: p.ownerUserId })
    .from(p)
    .where(eq(p.id, id))
    .limit(1)
    .for("update");
  return row ?? null;
}

async function writeLog(
  tx: DbExecutor,
  entry: { propertyId: string; actorUserId: string; action: ModerationAction; reason?: string | null; reportId?: string },
) {
  await tx.insert(log).values({ ...entry, reason: entry.reason ?? null, reportId: entry.reportId ?? null });
}

/**
 * Approve a listing in review. Its slot in the plan is already held, so only the plan's phase is
 * checked: it must be active. A listing returning after an edit keeps its first publish date.
 */
export async function approveListing(tx: DbExecutor, adminId: string, id: string, now = new Date()): Promise<DecisionResult> {
  if (!UUID.test(id)) return NOT_FOUND;
  const row = await lockListing(tx, id);
  if (!row) return NOT_FOUND;
  if (row.status !== "pending_review") return CONFLICT;
  if ((await listingPlanPhase(tx, row.ownerUserId, now)) !== "active") return { ok: false, reason: "plan_inactive" };

  const updated = await tx
    .update(p)
    .set({
      status: "published",
      publishedAt: sql`coalesce(${p.publishedAt}, ${now.toISOString()}::timestamptz)`,
      reviewedAt: now,
      reviewedBy: adminId,
      rejectionReason: null,
    })
    .where(and(eq(p.id, id), eq(p.status, "pending_review")))
    .returning({ id: p.id });
  if (updated.length === 0) return CONFLICT;
  await writeLog(tx, { propertyId: id, actorUserId: adminId, action: "approve" });
  return { ok: true };
}

/** Reject a listing in review with a reason the lister sees. */
export async function rejectListing(
  tx: DbExecutor,
  adminId: string,
  id: string,
  reason: string,
  now = new Date(),
): Promise<DecisionResult> {
  if (!UUID.test(id)) return NOT_FOUND;
  const row = await lockListing(tx, id);
  if (!row) return NOT_FOUND;
  if (row.status !== "pending_review") return CONFLICT;
  const updated = await tx
    .update(p)
    .set({ status: "rejected", rejectionReason: reason, reviewedAt: now, reviewedBy: adminId })
    .where(and(eq(p.id, id), eq(p.status, "pending_review")))
    .returning({ id: p.id });
  if (updated.length === 0) return CONFLICT;
  await writeLog(tx, { propertyId: id, actorUserId: adminId, action: "reject", reason });
  return { ok: true };
}

async function lockOpenReport(tx: DbExecutor, reportId: string) {
  if (!UUID.test(reportId)) return null;
  const [row] = await tx
    .select({ propertyId: r.propertyId, status: r.status })
    .from(r)
    .where(eq(r.id, reportId))
    .limit(1)
    .for("update");
  return row ?? null;
}

const isOpen = (status: string) => (OPEN_REPORT_STATUSES as readonly string[]).includes(status);

export async function dismissReport(tx: DbExecutor, adminId: string, reportId: string, now = new Date()): Promise<DecisionResult> {
  const report = await lockOpenReport(tx, reportId);
  if (!report) return NOT_FOUND;
  if (!isOpen(report.status)) return CONFLICT;
  await tx
    .update(r)
    .set({ status: "dismissed", resolvedBy: adminId, resolvedAt: now })
    .where(eq(r.id, reportId));
  await writeLog(tx, { propertyId: report.propertyId, actorUserId: adminId, action: "dismiss_report", reportId });
  return { ok: true };
}

/** Statuses a take-down moves to `rejected`; anything else is already out of public view. */
const TAKE_DOWN_FROM = ["published", "paused", "pending_review"] as const;

/**
 * Take a reported listing down: it becomes `rejected` with the reason (the lister can fix and
 * resubmit), and every open report on it is resolved.
 */
export async function takeDownForReport(
  tx: DbExecutor,
  adminId: string,
  reportId: string,
  reason: string,
  now = new Date(),
): Promise<DecisionResult> {
  const report = await lockOpenReport(tx, reportId);
  if (!report) return NOT_FOUND;
  if (!isOpen(report.status)) return CONFLICT;
  const listing = await lockListing(tx, report.propertyId);
  if (!listing) return NOT_FOUND;

  if ((TAKE_DOWN_FROM as readonly string[]).includes(listing.status)) {
    await tx
      .update(p)
      .set({ status: "rejected", rejectionReason: reason, reviewedAt: now, reviewedBy: adminId })
      .where(and(eq(p.id, report.propertyId), inArray(p.status, [...TAKE_DOWN_FROM])));
  }
  await tx
    .update(r)
    .set({ status: "resolved", resolvedBy: adminId, resolvedAt: now })
    .where(and(eq(r.propertyId, report.propertyId), inArray(r.status, [...OPEN_REPORT_STATUSES])));
  await writeLog(tx, { propertyId: report.propertyId, actorUserId: adminId, action: "take_down", reason, reportId });
  return { ok: true };
}
