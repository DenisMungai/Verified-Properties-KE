import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, like } from "drizzle-orm";
import sharp from "sharp";
import type { DbExecutor } from "@/db/executor";
import {
  getActivePlanByCode,
  getPlan,
  insertInvoice,
  insertManualPayment,
  insertPendingSubscription,
  lockLiveSubscription,
  type Plan,
} from "@/db/queries/payments";
import { grantRoles } from "@/db/queries/roles";
import {
  conversations,
  listerProfiles,
  listingModerationLog,
  payments,
  plans,
  properties,
  propertyImages,
  subscriptions,
  users,
  verificationAuditLog,
  verificationRequests,
} from "@/db/schema";
import { ACTIVE_LISTING_STATUSES, DAY_MS } from "@/lib/billing/constants";
import { confirmPayment } from "@/lib/mpesa/confirm";
import { listerRoleFor } from "@/lib/roles";
import { processAvatar, processImage, type ProcessedAvatarVariant, type ProcessedImage } from "@/lib/storage/image-processing";
import { avatarVariantKeys, newAvatarBaseKey, newImageBaseKey, variantKeys } from "@/lib/storage/keys";
import { variantSuffix } from "@/lib/storage/limits";
import { IMMUTABLE_CACHE, type ObjectStore } from "@/lib/storage/object-store";
import {
  SAMPLE_DECISION_REASON,
  SAMPLE_EMAIL_DOMAIN,
  SAMPLE_ID_PREFIX,
  SAMPLE_LISTERS,
  SAMPLE_LISTINGS,
  SAMPLE_PAYMENT_MARKER,
  SAMPLE_RECEIPT_PREFIX,
  SAMPLE_REJECTION_REASON,
  sampleAlt,
  type SampleAsset,
  type SampleAvatar,
  type SampleLister,
  type SampleListing,
} from "./sample-data";
import { SANDBOX_PLANS } from "./sandbox-plans";

/**
 * Seeding and removing the SAMPLE data (prompt S11 decisions 7–12). Payments go through the real
 * `confirmPayment`, verification is a real `verification_requests` row read by the derived view,
 * and photos go through the real image pipeline. Nothing here writes a badge or a status flag.
 */

export interface SeedDeps {
  db: DbExecutor;
  withTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  publicStore: ObjectStore;
  now: () => Date;
  /** Reads `scripts/seed-assets/<name>.webp`. */
  readAsset: (name: SampleAsset | SampleAvatar) => Promise<Buffer>;
}

export interface SeedOptions {
  /** User id and slug prefix. Must start with `sample-`; tests use `sample-t-`. */
  prefix?: string;
}

export type InsertResult = "inserted" | "existing";

export interface ListerSeedReport {
  userId: string;
  user: InsertResult;
  listingPlan: "paid" | "existing";
  verification: "paid" | "existing" | "-";
  verificationReview: InsertResult | "-";
  listingsInserted: number;
  listingsExisting: number;
  photos: number;
}

export interface SeedReport {
  plans: { code: string; result: InsertResult }[];
  listers: ListerSeedReport[];
}

export interface RemoveReport {
  listers: number;
  listingsDeleted: number;
  listingsArchived: number;
  photoObjectsDeleted: number;
  avatarsCleared: number;
  subscriptionsCancelled: number;
  verificationsExpired: number;
  storageErrors: number;
}

const LIVE_SUBSCRIPTION_STATUSES = ["pending", "active", "past_due", "paused"] as const;
/** The source photos are 636 × 636, below the 800 × 600 minimum; they are enlarged first. */
const UPSCALE_SIDE = 1200;
const REVIEW_VALID_MONTHS = 12;

export function samplePrefix(options: SeedOptions = {}): string {
  const prefix = options.prefix ?? SAMPLE_ID_PREFIX;
  if (!prefix.startsWith(SAMPLE_ID_PREFIX) || !/^[a-z0-9-]+$/.test(prefix)) {
    throw new Error(`Sample prefix must start with "${SAMPLE_ID_PREFIX}" and use a-z, 0-9 and "-" only.`);
  }
  return prefix;
}

export const sampleUserId = (prefix: string, lister: SampleLister) => `${prefix}${lister.key}`;
export const sampleEmail = (userId: string) => `${userId}@${SAMPLE_EMAIL_DOMAIN}`;
export const sampleSlug = (prefix: string, listing: SampleListing) => `${prefix}${listing.key}`;

/** Published plus in-review listings: the ones that use a plan slot. */
export function activeListingCount(listerKey: string): number {
  return SAMPLE_LISTINGS.filter(
    (listing) => listing.lister === listerKey && (ACTIVE_LISTING_STATUSES as readonly string[]).includes(listing.status),
  ).length;
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

async function ensurePlans(db: DbExecutor): Promise<SeedReport["plans"]> {
  const report: SeedReport["plans"] = [];
  for (const plan of SANDBOX_PLANS) {
    if (await getActivePlanByCode(db, plan.code)) {
      report.push({ code: plan.code, result: "existing" });
      continue;
    }
    const inserted = await db
      .insert(plans)
      .values(plan)
      .onConflictDoNothing({ target: [plans.code, plans.version] })
      .returning({ id: plans.id });
    report.push({ code: plan.code, result: inserted.length > 0 ? "inserted" : "existing" });
  }
  return report;
}

async function requirePlan(db: DbExecutor, code: string): Promise<Plan> {
  const plan = await getActivePlanByCode(db, code);
  if (!plan) throw new Error(`No active "${code}" plan. Add one with npm run plans:seed or a new plan version.`);
  return plan;
}

/* -------------------------------------------------------------------------- */
/* Photos                                                                     */
/* -------------------------------------------------------------------------- */

interface PreparedPhoto {
  storageKey: string;
  altText: string;
  width: number;
  height: number;
}

/** Processes each asset once and reuses the variants for every listing that shows it. */
function createPhotoCache(readAsset: SeedDeps["readAsset"]) {
  const photos = new Map<SampleAsset, Promise<ProcessedImage>>();
  const avatars = new Map<SampleAvatar, Promise<ProcessedAvatarVariant[]>>();
  return {
    photo(asset: SampleAsset): Promise<ProcessedImage> {
      let found = photos.get(asset);
      if (!found) {
        found = readAsset(asset).then(async (raw) => {
          const enlarged = await sharp(raw)
            .resize({ width: UPSCALE_SIDE, height: UPSCALE_SIDE, fit: "inside" })
            .webp({ quality: 90 })
            .toBuffer();
          return processImage(enlarged);
        });
        photos.set(asset, found);
      }
      return found;
    },
    avatar(name: SampleAvatar): Promise<ProcessedAvatarVariant[]> {
      let found = avatars.get(name);
      if (!found) {
        found = readAsset(name).then((raw) => processAvatar(raw));
        avatars.set(name, found);
      }
      return found;
    },
  };
}

type PhotoCache = ReturnType<typeof createPhotoCache>;

/** Every object key uploaded for one lister, so a failed transaction can take them all back. */
class Uploads {
  readonly imageBaseKeys: string[] = [];
  avatarBaseKey: string | null = null;

  allKeys(): string[] {
    return [
      ...this.imageBaseKeys.flatMap((key) => variantKeys(key)),
      ...(this.avatarBaseKey ? avatarVariantKeys(this.avatarBaseKey) : []),
    ];
  }
}

async function uploadListingPhotos(
  store: ObjectStore,
  cache: PhotoCache,
  uploads: Uploads,
  listingId: string,
  assets: SampleAsset[],
): Promise<PreparedPhoto[]> {
  const prepared: PreparedPhoto[] = [];
  for (const asset of assets) {
    const processed = await cache.photo(asset);
    const baseKey = newImageBaseKey(listingId);
    uploads.imageBaseKeys.push(baseKey);
    for (const variant of processed.variants) {
      await store.put(`${baseKey}${variantSuffix(variant.width)}`, variant.body, "image/webp", IMMUTABLE_CACHE);
    }
    prepared.push({ storageKey: baseKey, altText: sampleAlt(asset), width: processed.width, height: processed.height });
  }
  return prepared;
}

async function uploadAvatar(store: ObjectStore, cache: PhotoCache, uploads: Uploads, userId: string, name: SampleAvatar) {
  const variants = await cache.avatar(name);
  const baseKey = newAvatarBaseKey(userId);
  uploads.avatarBaseKey = baseKey;
  for (const variant of variants) {
    await store.put(`${baseKey}${variantSuffix(variant.size)}`, variant.body, "image/webp", IMMUTABLE_CACHE);
  }
  return baseKey;
}

async function deleteQuietly(store: ObjectStore, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  try {
    await store.delete(keys);
    return 0;
  } catch {
    return 1;
  }
}

/* -------------------------------------------------------------------------- */
/* Payments and verification                                                  */
/* -------------------------------------------------------------------------- */

/** The next free `SAMPLE####` receipt. Payments are never deleted, so a re-seed moves on. */
async function nextSampleReceipt(tx: DbExecutor): Promise<string> {
  const rows = await tx
    .select({ receipt: payments.mpesaReceipt })
    .from(payments)
    .where(like(payments.mpesaReceipt, `${SAMPLE_RECEIPT_PREFIX}%`));
  let highest = 0;
  for (const { receipt } of rows) {
    const n = Number(receipt?.slice(SAMPLE_RECEIPT_PREFIX.length));
    if (Number.isInteger(n) && n > highest) highest = n;
  }
  return `${SAMPLE_RECEIPT_PREFIX}${String(highest + 1).padStart(4, "0")}`;
}

/**
 * A paid subscription of this plan's kind, through the same rows and confirmation code as a real
 * payment: pending subscription, invoice (amount from `plans`), payment, `confirmPayment`. A live
 * paid subscription is left alone; a pending or paused one is paid (a paused one renews).
 */
async function ensurePaidSubscription(tx: DbExecutor, userId: string, plan: Plan, now: Date): Promise<"paid" | "existing"> {
  const owner = { kind: "user", userId } as const;
  const live = await lockLiveSubscription(tx, owner, plan.kind);
  if (live && (live.status === "active" || live.status === "past_due")) return "existing";

  const subscription = live ?? (await insertPendingSubscription(tx, owner, plan));
  const invoicePlan = live ? await getPlan(tx, live.planId) : plan;
  if (!invoicePlan) throw new Error("Sample subscription has no plan.");
  const amountKes = invoicePlan.priceKes;
  const invoice = await insertInvoice(tx, { subscriptionId: subscription.id, planId: invoicePlan.id, amountKes });
  const receipt = await nextSampleReceipt(tx);
  const payment = await insertManualPayment(tx, {
    invoiceId: invoice.id,
    phoneE164: null,
    mpesaReceipt: receipt,
    amountKes,
    paidAmountKes: amountKes,
    rawCallback: SAMPLE_PAYMENT_MARKER,
  });
  if (!payment) throw new Error(`Sample receipt ${receipt} is already used.`);
  const outcome = await confirmPayment(tx, payment.id, { receipt, paidAmount: amountKes, confirmedAt: now });
  if (outcome.outcome !== "confirmed") throw new Error(`Sample payment was not confirmed (${outcome.outcome}).`);
  return "paid";
}

async function ensureVerifiedReview(tx: DbExecutor, userId: string, now: Date): Promise<InsertResult> {
  const [current] = await tx
    .select({ id: verificationRequests.id })
    .from(verificationRequests)
    .where(
      and(
        eq(verificationRequests.listerUserId, userId),
        eq(verificationRequests.status, "verified"),
        gt(verificationRequests.reviewExpiresAt, now),
      ),
    )
    .limit(1);
  if (current) return "existing";
  const expires = new Date(now);
  expires.setUTCMonth(expires.getUTCMonth() + REVIEW_VALID_MONTHS);
  const [request] = await tx
    .insert(verificationRequests)
    .values({
      listerUserId: userId,
      status: "verified",
      submittedAt: now,
      decidedAt: now,
      decisionReason: SAMPLE_DECISION_REASON,
      reviewExpiresAt: expires,
    })
    .returning({ id: verificationRequests.id });
  // The audit trail the S11 exit report found missing: no admin decided it, so no actor.
  await tx.insert(verificationAuditLog).values({ requestId: request.id, actorUserId: null, action: "approve", reason: SAMPLE_DECISION_REASON });
  return "inserted";
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

interface ListerPlan {
  lister: SampleLister;
  userId: string;
  listingPlan: Plan;
  verificationPlan: Plan | null;
  /** Listings missing before the transaction, with their new ids and uploaded photos. */
  newListings: { listing: SampleListing; id: string; photos: PreparedPhoto[] }[];
  existingListings: number;
  avatarKey: string | null;
}

async function upsertUserAndProfile(tx: DbExecutor, plan: ListerPlan): Promise<{ user: InsertResult; avatarKey: string | null }> {
  const { lister, userId } = plan;
  const email = sampleEmail(userId);
  const inserted = await tx
    .insert(users)
    .values({ id: userId, name: lister.displayName, email, emailVerified: true })
    .onConflictDoNothing()
    .returning({ id: users.id });
  const [stored] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (stored?.email !== email) throw new Error(`User ${userId} exists with a non-sample email; refusing to touch it.`);

  const values = {
    listerType: lister.listerType,
    displayName: lister.displayName,
    bio: lister.bio,
    phone: null,
    publicEmail: null,
  };
  const [profile] = await tx
    .insert(listerProfiles)
    .values({ userId, ...values, avatarKey: plan.avatarKey })
    .onConflictDoNothing()
    .returning({ avatarKey: listerProfiles.avatarKey });
  let avatarKey = profile?.avatarKey ?? null;
  if (!profile && plan.avatarKey) {
    // Existing profile without an avatar (e.g. after --remove): give it the new one.
    const [updated] = await tx
      .update(listerProfiles)
      .set({ avatarKey: plan.avatarKey })
      .where(and(eq(listerProfiles.userId, userId), isNull(listerProfiles.avatarKey)))
      .returning({ avatarKey: listerProfiles.avatarKey });
    avatarKey = updated?.avatarKey ?? null;
  }
  await grantRoles(tx, userId, [listerRoleFor(lister.listerType)]);
  return { user: inserted.length > 0 ? "inserted" : "existing", avatarKey };
}

async function insertListing(
  tx: DbExecutor,
  plan: ListerPlan,
  entry: ListerPlan["newListings"][number],
  prefix: string,
  now: Date,
): Promise<boolean> {
  const { listing, id, photos } = entry;
  const at = new Date(now.getTime() - listing.ageDays * DAY_MS);
  const reviewed = (listing.status === "published" && !plan.lister.verified) || listing.status === "rejected";
  const inserted = await tx
    .insert(properties)
    .values({
      id,
      slug: sampleSlug(prefix, listing),
      ownerUserId: plan.userId,
      ...listing.fields,
      publicLatitude: listing.publicPoint.latitude,
      publicLongitude: listing.publicPoint.longitude,
      exactLatitude: null,
      exactLongitude: null,
      showExactLocation: false,
      status: listing.status,
      rejectionReason: listing.status === "rejected" ? SAMPLE_REJECTION_REASON : null,
      reviewedAt: reviewed ? at : null,
      publishedAt: listing.status === "published" ? at : null,
    })
    .onConflictDoNothing({ target: properties.slug })
    .returning({ id: properties.id });
  if (inserted.length === 0) return false;
  if (photos.length > 0) {
    await tx.insert(propertyImages).values(
      photos.map((photo, index) => ({
        propertyId: id,
        storageKey: photo.storageKey,
        altText: photo.altText,
        width: photo.width,
        height: photo.height,
        sortOrder: index,
        isCover: index === 0,
      })),
    );
  }
  return true;
}

async function seedLister(deps: SeedDeps, cache: PhotoCache, prefix: string, plan: ListerPlan): Promise<ListerSeedReport> {
  const { db, publicStore } = deps;
  const now = deps.now();
  const uploads = new Uploads();

  // Upload before the transaction; take everything back if it fails.
  const [profile] = await db
    .select({ avatarKey: listerProfiles.avatarKey })
    .from(listerProfiles)
    .where(eq(listerProfiles.userId, plan.userId))
    .limit(1);
  const existingSlugs = new Set(
    (
      await db
        .select({ slug: properties.slug })
        .from(properties)
        .where(inArray(properties.slug, SAMPLE_LISTINGS.filter((l) => l.lister === plan.lister.key).map((l) => sampleSlug(prefix, l))))
    ).map((row) => row.slug),
  );

  try {
    if (!profile?.avatarKey) plan.avatarKey = await uploadAvatar(publicStore, cache, uploads, plan.userId, plan.lister.avatar);
    for (const listing of SAMPLE_LISTINGS.filter((l) => l.lister === plan.lister.key)) {
      if (existingSlugs.has(sampleSlug(prefix, listing))) {
        plan.existingListings += 1;
        continue;
      }
      const id = randomUUID();
      plan.newListings.push({ listing, id, photos: await uploadListingPhotos(publicStore, cache, uploads, id, listing.photos) });
    }
  } catch (error) {
    await deleteQuietly(publicStore, uploads.allKeys());
    throw error;
  }

  let result: { report: ListerSeedReport; unusedKeys: string[] };
  try {
    result = await deps.withTransaction(async (tx) => {
      const { user, avatarKey } = await upsertUserAndProfile(tx, plan);
      const listingPlan = await ensurePaidSubscription(tx, plan.userId, plan.listingPlan, now);
      // The review first: with an approved review in place, the verification payment only renews
      // the badge and opens no new request (prompt S12 decision 3).
      const verificationReview = plan.lister.verified ? await ensureVerifiedReview(tx, plan.userId, now) : "-";
      const verification = plan.verificationPlan ? await ensurePaidSubscription(tx, plan.userId, plan.verificationPlan, now) : "-";

      const unusedKeys: string[] = [];
      let inserted = 0;
      let photos = 0;
      for (const entry of plan.newListings) {
        if (await insertListing(tx, plan, entry, prefix, now)) {
          inserted += 1;
          photos += entry.photos.length;
        } else {
          // Inserted by someone else since the check: its photos were never used.
          plan.existingListings += 1;
          unusedKeys.push(...entry.photos.flatMap((photo) => variantKeys(photo.storageKey)));
        }
      }
      if (uploads.avatarBaseKey && avatarKey !== uploads.avatarBaseKey) unusedKeys.push(...avatarVariantKeys(uploads.avatarBaseKey));

      return {
        report: {
          userId: plan.userId,
          user,
          listingPlan,
          verification,
          verificationReview,
          listingsInserted: inserted,
          listingsExisting: plan.existingListings,
          photos,
        },
        unusedKeys,
      };
    });
  } catch (error) {
    await deleteQuietly(publicStore, uploads.allKeys());
    throw error;
  }
  await deleteQuietly(publicStore, result.unusedKeys);
  return result.report;
}

/** Seeds every sample lister; re-running fills in what is missing and changes nothing else. */
export async function seedSampleData(deps: SeedDeps, options: SeedOptions = {}): Promise<SeedReport> {
  const prefix = samplePrefix(options);
  const planReport = await ensurePlans(deps.db);
  const verificationPlan = await requirePlan(deps.db, "verification");
  const cache = createPhotoCache(deps.readAsset);

  const listerPlans: ListerPlan[] = [];
  for (const lister of SAMPLE_LISTERS) {
    const listingPlan = await requirePlan(deps.db, lister.listingPlan);
    const needed = activeListingCount(lister.key);
    if (listingPlan.listingLimit !== null && needed > listingPlan.listingLimit) {
      throw new Error(`${lister.key} needs ${needed} listing slots but the ${lister.listingPlan} plan allows ${listingPlan.listingLimit}.`);
    }
    listerPlans.push({
      lister,
      userId: sampleUserId(prefix, lister),
      listingPlan,
      verificationPlan: lister.verified ? verificationPlan : null,
      newListings: [],
      existingListings: 0,
      avatarKey: null,
    });
  }

  const listers: ListerSeedReport[] = [];
  for (const plan of listerPlans) listers.push(await seedLister(deps, cache, prefix, plan));
  return { plans: planReport, listers };
}

/* -------------------------------------------------------------------------- */
/* Status (dry run)                                                           */
/* -------------------------------------------------------------------------- */

export interface SampleStatus {
  listers: { userId: string; exists: boolean }[];
  listingsExisting: number;
  listingsPlanned: number;
  photosPlanned: number;
}

/** What a seed would find, read-only. */
export async function sampleStatus(db: DbExecutor, options: SeedOptions = {}): Promise<SampleStatus> {
  const prefix = samplePrefix(options);
  const ids = SAMPLE_LISTERS.map((lister) => sampleUserId(prefix, lister));
  const found = new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((row) => row.id));
  const slugs = SAMPLE_LISTINGS.map((listing) => sampleSlug(prefix, listing));
  const existing = await db.select({ slug: properties.slug }).from(properties).where(inArray(properties.slug, slugs));
  return {
    listers: ids.map((userId) => ({ userId, exists: found.has(userId) })),
    listingsExisting: existing.length,
    listingsPlanned: SAMPLE_LISTINGS.length,
    photosPlanned: SAMPLE_LISTINGS.reduce((sum, listing) => sum + listing.photos.length, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Remove                                                                     */
/* -------------------------------------------------------------------------- */

/** Sample users only: id prefix AND the reserved email domain, so a real account can never match. */
async function sampleUserIds(db: DbExecutor, prefix: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(like(users.id, `${prefix}%`), like(users.email, `%@${SAMPLE_EMAIL_DOMAIN}`)));
  return rows.map((row) => row.id);
}

interface RemovedLister {
  deleted: number;
  archived: number;
  imageKeys: string[];
  avatarKey: string | null;
  subscriptionsCancelled: number;
  verificationsExpired: number;
}

async function removeLister(tx: DbExecutor, userId: string, now: Date): Promise<RemovedLister> {
  const listings = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.ownerUserId, userId))
    .for("update");
  const ids = listings.map((row) => row.id);
  let imageKeys: string[] = [];
  let archived: string[] = [];
  if (ids.length > 0) {
    imageKeys = (
      await tx.select({ key: propertyImages.storageKey }).from(propertyImages).where(inArray(propertyImages.propertyId, ids))
    ).map((row) => row.key);
    // An admin moderated it (append-only log) or a conversation points at it: archive, don't delete.
    const moderated = await tx
      .selectDistinct({ id: listingModerationLog.propertyId })
      .from(listingModerationLog)
      .where(inArray(listingModerationLog.propertyId, ids));
    const discussed = await tx
      .selectDistinct({ id: conversations.propertyId })
      .from(conversations)
      .where(inArray(conversations.propertyId, ids));
    archived = [...new Set([...moderated, ...discussed].map((row) => row.id))];
    if (archived.length > 0) {
      await tx.delete(propertyImages).where(inArray(propertyImages.propertyId, archived));
      await tx
        .update(properties)
        .set({ status: "archived", pausedAt: null, pauseReason: null })
        .where(inArray(properties.id, archived));
    }
    const deletable = ids.filter((id) => !archived.includes(id));
    // Images, favourites, inquiries and reports cascade.
    if (deletable.length > 0) await tx.delete(properties).where(inArray(properties.id, deletable));
  }

  const [profile] = await tx
    .select({ avatarKey: listerProfiles.avatarKey })
    .from(listerProfiles)
    .where(eq(listerProfiles.userId, userId))
    .for("update")
    .limit(1);
  if (profile?.avatarKey) await tx.update(listerProfiles).set({ avatarKey: null }).where(eq(listerProfiles.userId, userId));

  const cancelled = await tx
    .update(subscriptions)
    .set({ status: "cancelled", cancelledAt: now })
    .where(and(eq(subscriptions.ownerUserId, userId), inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES])))
    .returning({ id: subscriptions.id });
  const expired = await tx
    .update(verificationRequests)
    .set({ status: "expired" })
    .where(and(eq(verificationRequests.listerUserId, userId), eq(verificationRequests.status, "verified")))
    .returning({ id: verificationRequests.id });

  return {
    deleted: ids.length - archived.length,
    archived: archived.length,
    imageKeys,
    avatarKey: profile?.avatarKey ?? null,
    subscriptionsCancelled: cancelled.length,
    verificationsExpired: expired.length,
  };
}

/**
 * Takes the sample data down: listings deleted (archived if moderated), photo and avatar objects
 * deleted, subscriptions cancelled, verified reviews expired. Users, profiles, invoices, payments
 * and events stay; they have no public presence and can't sign in.
 */
export async function removeSampleData(deps: SeedDeps, options: SeedOptions = {}): Promise<RemoveReport> {
  const prefix = samplePrefix(options);
  const report: RemoveReport = {
    listers: 0,
    listingsDeleted: 0,
    listingsArchived: 0,
    photoObjectsDeleted: 0,
    avatarsCleared: 0,
    subscriptionsCancelled: 0,
    verificationsExpired: 0,
    storageErrors: 0,
  };
  for (const userId of await sampleUserIds(deps.db, prefix)) {
    const removed = await deps.withTransaction((tx) => removeLister(tx, userId, deps.now()));
    report.listers += 1;
    report.listingsDeleted += removed.deleted;
    report.listingsArchived += removed.archived;
    report.subscriptionsCancelled += removed.subscriptionsCancelled;
    report.verificationsExpired += removed.verificationsExpired;

    // Storage deletes run after the commit.
    const imageObjects = removed.imageKeys.flatMap((key) => variantKeys(key));
    const imageErrors = await deleteQuietly(deps.publicStore, imageObjects);
    report.storageErrors += imageErrors;
    if (imageErrors === 0) report.photoObjectsDeleted += imageObjects.length;
    if (removed.avatarKey) {
      report.storageErrors += await deleteQuietly(deps.publicStore, avatarVariantKeys(removed.avatarKey));
      report.avatarsCleared += 1;
    }
  }
  return report;
}
