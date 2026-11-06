import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import {
  agencies,
  listerProfiles,
  plans,
  subscriptions,
  users,
  verificationAuditLog,
  verificationDocuments,
  verificationRequests,
} from "@/db/schema";
import { OPEN_STATUSES, type AuditAction, type DocumentType, type VerificationStatus } from "@/lib/verification/rules";

/**
 * Verification data access (prompt S12). Lister reads are always scoped by the session user id;
 * admin reads are for `platform_admin` callers only. Writes take a transaction so each state
 * change and its append-only audit row commit together.
 */

const vr = verificationRequests;
const vd = verificationDocuments;
const log = verificationAuditLog;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export type VerificationRequest = typeof vr.$inferSelect;
export type VerificationDocument = typeof vd.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Lister context                                                             */
/* -------------------------------------------------------------------------- */

export interface ListerContext {
  userId: string;
  name: string;
  email: string;
  listerType: "agent" | "owner" | "developer";
  displayName: string;
  agencyId: string | null;
  agencyName: string | null;
  phone: string | null;
}

export async function getListerContext(db: DbExecutor, userId: string): Promise<ListerContext | null> {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      listerType: listerProfiles.listerType,
      displayName: listerProfiles.displayName,
      agencyId: listerProfiles.agencyId,
      agencyName: agencies.name,
      phone: listerProfiles.phone,
    })
    .from(listerProfiles)
    .innerJoin(users, eq(users.id, listerProfiles.userId))
    .leftJoin(agencies, eq(agencies.id, listerProfiles.agencyId))
    .where(eq(listerProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

/** The lister's live verification subscription and its plan, for checkout and the status page. */
export async function getVerificationSubscription(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.ownerUserId, userId),
        eq(subscriptions.kind, "verification"),
        inArray(subscriptions.status, ["pending", "active", "past_due", "paused"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

/** The lister's most recent request of any status. */
export async function getLatestRequest(db: DbExecutor, userId: string): Promise<VerificationRequest | null> {
  // An open request is always the newest; it also wins a same-instant tie.
  const isOpen = sql`${vr.status} in ('payment_pending', 'documents_pending', 'under_review')`;
  const [row] = await db.select().from(vr).where(eq(vr.listerUserId, userId)).orderBy(desc(vr.createdAt), desc(isOpen)).limit(1);
  return row ?? null;
}

/** The lister's single open request, locked when `lock` is set. */
export async function getOpenRequest(db: DbExecutor, userId: string, lock = false): Promise<VerificationRequest | null> {
  const query = db
    .select()
    .from(vr)
    .where(and(eq(vr.listerUserId, userId), inArray(vr.status, [...OPEN_STATUSES])))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/** A passed review that hasn't expired: paying for verification then only renews the badge. */
export async function getUnexpiredVerifiedRequest(db: DbExecutor, userId: string, now: Date): Promise<VerificationRequest | null> {
  const [row] = await db
    .select()
    .from(vr)
    .where(and(eq(vr.listerUserId, userId), eq(vr.status, "verified"), gt(vr.reviewExpiresAt, now)))
    .orderBy(desc(vr.reviewExpiresAt))
    .limit(1);
  return row ?? null;
}

export async function lockRequest(tx: DbExecutor, id: string): Promise<VerificationRequest | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(vr).where(eq(vr.id, id)).limit(1).for("update");
  return row ?? null;
}

/** The lister's most recent approved review, current or ended (`verified` or `expired`). */
export async function getLastApprovedRequest(db: DbExecutor, userId: string): Promise<VerificationRequest | null> {
  const [row] = await db
    .select()
    .from(vr)
    .where(and(eq(vr.listerUserId, userId), inArray(vr.status, ["verified", "expired"]), isNotNull(vr.decidedAt)))
    .orderBy(desc(vr.decidedAt))
    .limit(1);
  return row ?? null;
}

/** When the lister was first approved (the "since you were verified" baseline), or null. */
export async function getFirstApprovalAt(db: DbExecutor, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: vr.decidedAt })
    .from(vr)
    .where(and(eq(vr.listerUserId, userId), inArray(vr.status, ["verified", "expired"]), isNotNull(vr.decidedAt)))
    .orderBy(asc(vr.decidedAt))
    .limit(1);
  return row?.at ?? null;
}

export async function insertRequest(
  tx: DbExecutor,
  values: { listerUserId: string; status: VerificationStatus; invoiceId: string | null; renewsRequestId?: string | null },
): Promise<VerificationRequest> {
  const [row] = await tx.insert(vr).values(values).returning();
  return row;
}

export async function updateRequest(
  tx: DbExecutor,
  id: string,
  values: Partial<
    Pick<
      VerificationRequest,
      "status" | "invoiceId" | "submittedAt" | "decidedAt" | "decidedBy" | "decisionReason" | "reviewExpiresAt" | "endedAt" | "documentsPurgedAt"
    >
  >,
): Promise<void> {
  await tx.update(vr).set(values).where(eq(vr.id, id));
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export async function insertAudit(
  tx: DbExecutor,
  values: { requestId: string; actorUserId: string | null; action: AuditAction; reason?: string | null },
): Promise<void> {
  // clock_timestamp(), not now(): several rows written in one transaction (reject + credit) keep
  // their order in the history.
  await tx.insert(log).values({ ...values, reason: values.reason ?? null, createdAt: sql`clock_timestamp()` });
}

export interface AuditEntry {
  id: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  actorName: string | null;
}

export async function auditTrail(db: DbExecutor, requestId: string): Promise<AuditEntry[]> {
  return db
    .select({ id: log.id, action: log.action, reason: log.reason, createdAt: log.createdAt, actorName: users.name })
    .from(log)
    .leftJoin(users, eq(users.id, log.actorUserId))
    .where(eq(log.requestId, requestId))
    .orderBy(asc(log.createdAt));
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

export async function listDocuments(db: DbExecutor, requestId: string): Promise<VerificationDocument[]> {
  return db.select().from(vd).where(eq(vd.requestId, requestId)).orderBy(asc(vd.uploadedAt));
}

export async function insertDocument(
  tx: DbExecutor,
  values: {
    id: string;
    requestId: string;
    storageKey: string;
    documentType: DocumentType;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<void> {
  await tx.insert(vd).values(values);
}

/** Deletes one of this request's documents; returns its storage key, or null if it wasn't there. */
export async function deleteDocument(tx: DbExecutor, requestId: string, documentId: string): Promise<VerificationDocument | null> {
  if (!isUuid(documentId)) return null;
  const [row] = await tx.delete(vd).where(and(eq(vd.id, documentId), eq(vd.requestId, requestId))).returning();
  return row ?? null;
}

/** For the admin document route: the document and whose request it belongs to. */
export async function getDocumentWithLister(
  db: DbExecutor,
  documentId: string,
): Promise<(VerificationDocument & { listerUserId: string }) | null> {
  if (!isUuid(documentId)) return null;
  const [row] = await db
    .select({ document: vd, listerUserId: vr.listerUserId })
    .from(vd)
    .innerJoin(vr, eq(vr.id, vd.requestId))
    .where(eq(vd.id, documentId))
    .limit(1);
  return row ? { ...row.document, listerUserId: row.listerUserId } : null;
}

/** Which of these keys a document row still uses (storage cleanup). */
export async function referencedDocumentKeys(db: DbExecutor, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.select({ key: vd.storageKey }).from(vd).where(inArray(vd.storageKey, keys));
  return new Set(rows.map((r) => r.key));
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export type QueueTab = "under_review" | "documents_pending" | "verified" | "expired" | "rejected" | "suspended";

export interface QueueRow {
  id: string;
  status: VerificationStatus;
  listerName: string;
  listerType: "agent" | "owner" | "developer";
  agencyName: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  updatedAt: Date;
  /** Set on a re-review (S13). */
  renewsRequestId: string | null;
}

const QUEUE_LIMIT = 200;

/** Under review: oldest submitted first. Other tabs: most recently changed first. */
export async function verificationQueue(db: DbExecutor, tab: QueueTab): Promise<QueueRow[]> {
  const order = tab === "under_review" ? [asc(vr.submittedAt)] : [desc(vr.updatedAt)];
  return db
    .select({
      id: vr.id,
      status: vr.status,
      listerName: sql<string>`coalesce(${listerProfiles.displayName}, ${users.name})`,
      listerType: listerProfiles.listerType,
      agencyName: agencies.name,
      submittedAt: vr.submittedAt,
      decidedAt: vr.decidedAt,
      updatedAt: vr.updatedAt,
      renewsRequestId: vr.renewsRequestId,
    })
    .from(vr)
    .innerJoin(users, eq(users.id, vr.listerUserId))
    .innerJoin(listerProfiles, eq(listerProfiles.userId, vr.listerUserId))
    .leftJoin(agencies, eq(agencies.id, listerProfiles.agencyId))
    .where(eq(vr.status, tab))
    .orderBy(...order)
    .limit(QUEUE_LIMIT);
}

export async function verificationCounts(db: DbExecutor): Promise<{ underReview: number }> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(vr).where(eq(vr.status, "under_review"));
  return { underReview: row?.n ?? 0 };
}

export interface ReviewDetail {
  request: VerificationRequest;
  lister: ListerContext;
  documents: VerificationDocument[];
  audit: AuditEntry[];
}

export async function getRequestForReview(db: DbExecutor, id: string): Promise<ReviewDetail | null> {
  if (!isUuid(id)) return null;
  const [request] = await db.select().from(vr).where(eq(vr.id, id)).limit(1);
  if (!request) return null;
  const [lister, documents, audit] = await Promise.all([
    getListerContext(db, request.listerUserId),
    listDocuments(db, request.id),
    auditTrail(db, request.id),
  ]);
  if (!lister) return null;
  return { request, lister, documents, audit };
}
