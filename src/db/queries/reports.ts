import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { listingReports, properties, users } from "@/db/schema";
import type { ReportInput } from "@/lib/validation/engagement";
import { manageableBy } from "./listings";

/** Listing reports (prompt S8 decision 5). One open report per person per listing (unique index). */

const p = properties;
const r = listingReports;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPEN_REPORT_STATUSES = ["open", "reviewing"] as const;

export type ReportResult = { ok: true } | { ok: false; reason: "unavailable" | "own_listing" | "already_reported" };

export async function createReport(
  db: DbExecutor,
  reporterId: string,
  propertyId: string,
  input: ReportInput,
): Promise<ReportResult> {
  if (!UUID.test(propertyId)) return { ok: false, reason: "unavailable" };
  const [property] = await db
    .select({ mine: sql<boolean>`${manageableBy(reporterId)}` })
    .from(p)
    .where(and(eq(p.id, propertyId), eq(p.status, "published")))
    .limit(1);
  if (!property) return { ok: false, reason: "unavailable" };
  if (property.mine) return { ok: false, reason: "own_listing" };

  // The only possible conflict is the one-open-report-per-reporter index.
  const inserted = await db
    .insert(r)
    .values({ propertyId, reporterUserId: reporterId, reason: input.reason, details: input.details })
    .onConflictDoNothing()
    .returning({ id: r.id });
  return inserted.length > 0 ? { ok: true } : { ok: false, reason: "already_reported" };
}

/** Open reports for the admin queue, newest first. */
export async function listOpenReports(db: DbExecutor) {
  return db
    .select({
      id: r.id,
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt,
      reporterName: users.name,
      propertyId: p.id,
      propertyTitle: p.title,
      propertySlug: p.slug,
      propertyStatus: p.status,
    })
    .from(r)
    .innerJoin(p, eq(p.id, r.propertyId))
    .leftJoin(users, eq(users.id, r.reporterUserId))
    .where(inArray(r.status, [...OPEN_REPORT_STATUSES]))
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(200);
}

export type OpenReport = Awaited<ReturnType<typeof listOpenReports>>[number];
