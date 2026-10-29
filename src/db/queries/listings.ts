import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/db/executor";
import { listerProfiles, properties, users } from "@/db/schema";
import type { PublishEntitlement } from "@/lib/billing/entitlements";
import { makeSlug } from "@/lib/listings/slug";
import {
  canDeleteDraft,
  canSubmit,
  isEditableByLister,
  isMaterialEdit,
  listerCanTransition,
  statusAfterEdit,
  type ListerTransitionTarget,
  type ListingStatus,
} from "@/lib/listings/workflow";
import {
  normalizeForCategory,
  parseListing,
  type BasicsInput,
  type DetailsInput,
  type ListingFields,
} from "@/lib/validation/listing";
import { getListingPool, getPublishEntitlement, isListerVerified, type ListingPool } from "./billing";

/**
 * Lister-side listing data (plan v2.0 §9; prompt S3). The only access rule is `manageableBy`:
 * the listing's owner, or an admin of the agency the listing belongs to. Every function applies
 * it, so a forged id reaches nothing. Exact coordinates are never selected here.
 */

const p = properties;

export function manageableBy(userId: string): SQL {
  return sql`(${p.ownerUserId} = ${userId} or ${p.agencyId} in (
    select agency_id from agency_members where user_id = ${userId} and role = 'admin'
  ))`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Columns the editor uses. Deliberately excludes exact_* and the public map point. */
const editorColumns = {
  id: p.id,
  slug: p.slug,
  ownerUserId: p.ownerUserId,
  agencyId: p.agencyId,
  status: p.status,
  title: p.title,
  description: p.description,
  listingType: p.listingType,
  category: p.category,
  subtype: p.subtype,
  priceKes: p.priceKes,
  rentPeriod: p.rentPeriod,
  bedrooms: p.bedrooms,
  bathrooms: p.bathrooms,
  areaSqm: p.areaSqm,
  landSize: p.landSize,
  landSizeUnit: p.landSizeUnit,
  furnished: p.furnished,
  parkingSpaces: p.parkingSpaces,
  amenities: p.amenities,
  zoningNotes: p.zoningNotes,
  county: p.county,
  town: p.town,
  neighbourhood: p.neighbourhood,
  rejectionReason: p.rejectionReason,
  publishedAt: p.publishedAt,
  reviewedAt: p.reviewedAt,
  pausedAt: p.pausedAt,
  pauseReason: p.pauseReason,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
};

export type EditableListing = {
  [K in keyof typeof editorColumns]: (typeof editorColumns)[K]["_"]["notNull"] extends true
    ? (typeof editorColumns)[K]["_"]["data"]
    : (typeof editorColumns)[K]["_"]["data"] | null;
};

export type ListingResult =
  | { ok: true; status: ListingStatus; returnedToReview?: boolean }
  | { ok: false; reason: "not_found" | "not_allowed" | "conflict" }
  | { ok: false; reason: "invalid"; errors: Record<string, string> }
  | { ok: false; reason: "entitlement"; entitlement: Extract<PublishEntitlement, { ok: false }> };

const NOT_FOUND = { ok: false, reason: "not_found" } as const;
const NOT_ALLOWED = { ok: false, reason: "not_allowed" } as const;
const CONFLICT = { ok: false, reason: "conflict" } as const;

/** The stored row as validated listing fields. */
export function listingFieldsOf(row: EditableListing): ListingFields {
  return {
    title: row.title,
    listingType: row.listingType,
    category: row.category,
    county: row.county,
    town: row.town,
    neighbourhood: row.neighbourhood,
    priceKes: row.priceKes,
    rentPeriod: row.rentPeriod,
    bedrooms: row.bedrooms,
    description: row.description,
    bathrooms: row.bathrooms,
    areaSqm: row.areaSqm,
    landSize: row.landSize,
    landSizeUnit: row.landSizeUnit,
    furnished: row.furnished,
    parkingSpaces: row.parkingSpaces,
    amenities: row.amenities,
    subtype: row.subtype,
    zoningNotes: row.zoningNotes,
  };
}

/** One manageable listing, or null (unknown, malformed or someone else's id). */
export async function getManageableListing(
  db: DbExecutor,
  userId: string,
  id: string,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<EditableListing | null> {
  if (!UUID.test(id)) return null;
  const query = db
    .select(editorColumns)
    .from(p)
    .where(and(eq(p.id, id), manageableBy(userId)))
    .limit(1);
  const [row] = forUpdate ? await query.for("update") : await query;
  return row ?? null;
}

export async function listManageableListings(db: DbExecutor, userId: string) {
  return db
    .select({
      id: p.id,
      title: p.title,
      status: p.status,
      listingType: p.listingType,
      county: p.county,
      town: p.town,
      neighbourhood: p.neighbourhood,
      rejectionReason: p.rejectionReason,
      publishedAt: p.publishedAt,
      reviewedAt: p.reviewedAt,
      updatedAt: p.updatedAt,
      ownerUserId: p.ownerUserId,
      ownerName: users.name,
    })
    .from(p)
    .innerJoin(users, eq(users.id, p.ownerUserId))
    .where(manageableBy(userId))
    .orderBy(desc(p.updatedAt), desc(p.id));
}

export type ManageableListingRow = Awaited<ReturnType<typeof listManageableListings>>[number];

const EMPTY_DETAILS: DetailsInput = {
  description: "",
  bathrooms: null,
  areaSqm: null,
  landSize: null,
  landSizeUnit: null,
  furnished: false,
  parkingSpaces: null,
  amenities: [],
  subtype: null,
  zoningNotes: null,
};

/**
 * Creates a draft owned by `userId`. The agency comes from the creator's lister profile, never
 * from the form; status is always draft. Retries the random slug suffix on the rare collision.
 */
export async function createDraft(db: DbExecutor, userId: string, input: BasicsInput): Promise<{ id: string }> {
  const [profile] = await db
    .select({ agencyId: listerProfiles.agencyId })
    .from(listerProfiles)
    .where(eq(listerProfiles.userId, userId))
    .limit(1);
  const fields = normalizeForCategory({ ...EMPTY_DETAILS, ...input });
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .insert(p)
      .values({
        ...fields,
        slug: makeSlug(fields.title),
        ownerUserId: userId,
        agencyId: profile?.agencyId ?? null,
        status: "draft",
      })
      .onConflictDoNothing({ target: p.slug })
      .returning({ id: p.id });
    if (row) return row;
  }
  throw new Error("Could not allocate a listing slug");
}

/**
 * Saves one step. A material change by an unverified owner sends a published listing back to
 * review (it keeps its slot, as pending_review counts towards the plan limit) and turns a paused
 * listing into a draft that must be resubmitted.
 */
export async function updateListing(
  db: DbExecutor,
  userId: string,
  id: string,
  patch: Partial<ListingFields>,
): Promise<ListingResult> {
  const before = await getManageableListing(db, userId, id);
  if (!before) return NOT_FOUND;
  if (!isEditableByLister(before.status)) return NOT_ALLOWED;

  const current = listingFieldsOf(before);
  const next = normalizeForCategory({ ...current, ...patch });
  const material = isMaterialEdit(current, next);
  const ownerVerified =
    material && (before.status === "published" || before.status === "paused")
      ? await isListerVerified(db, before.ownerUserId)
      : false;
  const status = statusAfterEdit(before.status, material, ownerVerified);
  const leftPause = before.status === "paused" && status !== "paused";

  const updated = await db
    .update(p)
    .set({ ...next, status, ...(leftPause ? { pausedAt: null, pauseReason: null } : {}) })
    .where(and(eq(p.id, id), eq(p.status, before.status), manageableBy(userId)))
    .returning({ id: p.id });
  if (updated.length === 0) return CONFLICT;
  return { ok: true, status, returnedToReview: status !== before.status };
}

/** Serialises entitlement checks per listing pool for the rest of the transaction. */
async function lockPool(tx: DbExecutor, pool: ListingPool): Promise<void> {
  const key = pool.kind === "agency" ? `pool:agency:${pool.agencyId}` : `pool:user:${pool.userId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

async function checkEntitlement(
  tx: DbExecutor,
  ownerUserId: string,
  now: Date,
): Promise<Extract<ListingResult, { reason: "entitlement" }> | null> {
  await lockPool(tx, await getListingPool(tx, ownerUserId));
  const entitlement = await getPublishEntitlement(tx, ownerUserId, now);
  return entitlement.ok ? null : { ok: false, reason: "entitlement", entitlement };
}

/**
 * Submit (prompt S3 decision 6). Must run inside a transaction: the row and the owner's listing
 * pool are locked, so two parallel submits cannot both take the last slot. Verified owners
 * publish at once; everyone else goes to review.
 */
export async function submitListing(tx: DbExecutor, userId: string, id: string, now = new Date()): Promise<ListingResult> {
  const row = await getManageableListing(tx, userId, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (!canSubmit(row.status)) return NOT_ALLOWED;

  const parsed = parseListing(listingFieldsOf(row));
  if (!parsed.success) return { ok: false, reason: "invalid", errors: parsed.errors };

  const blocked = await checkEntitlement(tx, row.ownerUserId, now);
  if (blocked) return blocked;

  const verified = await isListerVerified(tx, row.ownerUserId);
  const status: ListingStatus = verified ? "published" : "pending_review";
  const updated = await tx
    .update(p)
    .set({
      ...parsed.data,
      status,
      rejectionReason: null,
      ...(verified ? { publishedAt: now } : {}),
    })
    .where(and(eq(p.id, id), eq(p.status, row.status)))
    .returning({ id: p.id });
  return updated.length === 0 ? CONFLICT : { ok: true, status };
}

/** Un-pause: billing paused it, so no re-review. Needs a paid-up plan with a free slot. */
export async function unpauseListing(tx: DbExecutor, userId: string, id: string, now = new Date()): Promise<ListingResult> {
  const row = await getManageableListing(tx, userId, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (row.status !== "paused") return NOT_ALLOWED;

  const blocked = await checkEntitlement(tx, row.ownerUserId, now);
  if (blocked) return blocked;

  const updated = await tx
    .update(p)
    .set({ status: "published", pausedAt: null, pauseReason: null, publishedAt: row.publishedAt ?? now })
    .where(and(eq(p.id, id), eq(p.status, "paused")))
    .returning({ id: p.id });
  return updated.length === 0 ? CONFLICT : { ok: true, status: "published" };
}

/** Plain lister status changes: withdraw submission, rented, sold, withdrawn, archived. */
export async function transitionListing(
  db: DbExecutor,
  userId: string,
  id: string,
  to: ListerTransitionTarget,
): Promise<ListingResult> {
  const row = await getManageableListing(db, userId, id);
  if (!row) return NOT_FOUND;
  if (!listerCanTransition(row.status, to, { listingType: row.listingType })) return NOT_ALLOWED;
  const updated = await db
    .update(p)
    .set({ status: to })
    .where(and(eq(p.id, id), eq(p.status, row.status), manageableBy(userId)))
    .returning({ id: p.id });
  return updated.length === 0 ? CONFLICT : { ok: true, status: to };
}

/** Deletes a draft that was never published or reviewed; anything else is archived instead. */
export async function deleteDraft(db: DbExecutor, userId: string, id: string): Promise<ListingResult> {
  const row = await getManageableListing(db, userId, id);
  if (!row) return NOT_FOUND;
  if (!canDeleteDraft(row)) return NOT_ALLOWED;
  const deleted = await db
    .delete(p)
    .where(
      and(
        eq(p.id, id),
        eq(p.status, "draft"),
        sql`${p.publishedAt} is null and ${p.reviewedAt} is null`,
        manageableBy(userId),
      ),
    )
    .returning({ id: p.id });
  return deleted.length === 0 ? CONFLICT : { ok: true, status: "draft" };
}
