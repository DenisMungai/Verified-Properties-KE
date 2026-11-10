import "server-only";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { dataRequests, users } from "@/db/schema";
import type { DataRequestKind } from "@/lib/legal";
import type { DataRequestInput } from "@/lib/validation/data-request";

/**
 * Data requests (prompt S20 decision 7). A user only ever reads their own; the admin list is
 * reached from the role-guarded admin page only. Closing is a guarded update, so a second close
 * (or a race between two admins) changes nothing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_LIST_LIMIT = 100;

export interface OwnDataRequest {
  id: string;
  kind: DataRequestKind;
  details: string;
  status: "open" | "closed";
  resolutionNote: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

export interface AdminDataRequest extends OwnDataRequest {
  userName: string;
  userEmail: string;
}

const ownColumns = {
  id: dataRequests.id,
  kind: sql<DataRequestKind>`${dataRequests.kind}`,
  details: dataRequests.details,
  status: sql<"open" | "closed">`${dataRequests.status}`,
  resolutionNote: dataRequests.resolutionNote,
  createdAt: dataRequests.createdAt,
  closedAt: dataRequests.closedAt,
};

export async function createDataRequest(db: DbExecutor, userId: string, input: DataRequestInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(dataRequests)
    .values({ userId, kind: input.kind, details: input.details })
    .returning({ id: dataRequests.id });
  return row;
}

/** The signed-in user's own requests, newest first. */
export async function listOwnDataRequests(db: DbExecutor, userId: string): Promise<OwnDataRequest[]> {
  return db.select(ownColumns).from(dataRequests).where(eq(dataRequests.userId, userId)).orderBy(desc(dataRequests.createdAt));
}

/** Admin queue: open requests oldest first, then the most recently closed. */
export async function listDataRequestsForAdmin(db: DbExecutor): Promise<AdminDataRequest[]> {
  return db
    .select({ ...ownColumns, userName: users.name, userEmail: users.email })
    .from(dataRequests)
    .innerJoin(users, eq(users.id, dataRequests.userId))
    .orderBy(
      sql`case when ${dataRequests.status} = 'open' then 0 else 1 end`,
      sql`case when ${dataRequests.status} = 'open' then ${dataRequests.createdAt} end asc`,
      desc(dataRequests.closedAt),
      asc(dataRequests.id),
    )
    .limit(ADMIN_LIST_LIMIT);
}

export async function countOpenDataRequests(db: DbExecutor): Promise<number> {
  const [row] = await db.select({ n: count() }).from(dataRequests).where(eq(dataRequests.status, "open"));
  return row?.n ?? 0;
}

export type CloseResult = { ok: true } | { ok: false; reason: "not_found" | "already_closed" };

export async function closeDataRequest(db: DbExecutor, adminId: string, id: string, note: string, now = new Date()): Promise<CloseResult> {
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const closed = await db
    .update(dataRequests)
    .set({ status: "closed", resolutionNote: note, closedBy: adminId, closedAt: now })
    .where(and(eq(dataRequests.id, id), eq(dataRequests.status, "open")))
    .returning({ id: dataRequests.id });
  if (closed.length > 0) return { ok: true };
  const [exists] = await db.select({ id: dataRequests.id }).from(dataRequests).where(eq(dataRequests.id, id)).limit(1);
  return { ok: false, reason: exists ? "already_closed" : "not_found" };
}
