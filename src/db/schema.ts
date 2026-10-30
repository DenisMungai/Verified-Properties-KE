import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Schema for VerifiedPropertiesKE (plan v2.0 §6): core tables (0001) and billing (0002).
 *
 * Rules encoded here:
 *  - Money is whole KES in integer columns.
 *  - The verified badge is never stored: the `verified_listers_now` view and the
 *    `lister_verified_now()` function (hand-written SQL in 0002) derive it from
 *    verification_requests plus active subscriptions. There is no per-profile or per-listing
 *    verified/featured flag.
 *  - Exact coordinates live in `exact_*` columns that public queries must never select.
 */

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const timestamps = {
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Largest integer JavaScript can hold exactly; bigint money columns are read as numbers. */
const MAX_SAFE_INTEGER = "9007199254740991";

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const appRole = pgEnum("app_role", [
  "buyer_tenant",
  "owner",
  "agent",
  "agency_admin",
  "platform_admin",
  "billing_admin",
]);

/** Buy / Rent in the UI. "Land" is a category, not a listing type. */
export const listingType = pgEnum("listing_type", ["sale", "rent"]);

export const propertyCategory = pgEnum("property_category", [
  "house",
  "apartment",
  "land",
  "commercial",
]);

/** Only `published` is ever public. `paused`: plan lapsed past grace, or over the plan limit. */
export const listingStatus = pgEnum("listing_status", [
  "draft",
  "pending_review",
  "published",
  "paused",
  "rejected",
  "rented",
  "sold",
  "withdrawn",
  "archived",
]);

export const rentPeriod = pgEnum("rent_period", ["week", "month", "year"]);
export const landSizeUnit = pgEnum("land_size_unit", ["sqm", "acre", "hectare"]);
export const listerType = pgEnum("lister_type", ["agent", "owner", "developer"]);

export const verificationStatus = pgEnum("verification_status", [
  "unverified",
  "payment_pending",
  "under_review",
  "verified",
  "rejected",
  "expired",
  "suspended",
]);

export const agencyMemberRole = pgEnum("agency_member_role", ["admin", "member"]);

export const reportStatus = pgEnum("report_status", ["open", "reviewing", "resolved", "dismissed"]);

/* -------------------------------------------------------------------------- */
/* Users and Better Auth core tables                                          */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Password hash for the email/password provider (never plaintext). */
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Roles are written only by server code and operator scripts, never by the user. */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: appRole("role").notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/* -------------------------------------------------------------------------- */
/* Agencies and lister profiles                                               */
/* -------------------------------------------------------------------------- */

export const agencies = pgTable("agencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoKey: text("logo_key"),
  websiteUrl: text("website_url"),
  publicEmail: text("public_email"),
  publicPhone: text("public_phone"),
  ...timestamps,
});

export const agencyMembers = pgTable(
  "agency_members",
  {
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: agencyMemberRole("role").notNull().default("member"),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.agencyId, t.userId] }), index("agency_members_user_idx").on(t.userId)],
);

/** Public identity for anyone who lists: agents, private owners, developers. */
export const listerProfiles = pgTable("lister_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  listerType: listerType("lister_type").notNull().default("agent"),
  displayName: text("display_name").notNull(),
  /** E.164, e.g. +254712345678. Public only while the lister is verified (plan §16). */
  phone: text("phone"),
  publicEmail: text("public_email"),
  avatarKey: text("avatar_key"),
  agencyId: uuid("agency_id").references(() => agencies.id, { onDelete: "set null" }),
  bio: text("bio"),
  ...timestamps,
});

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    agencyId: uuid("agency_id").references(() => agencies.id, { onDelete: "set null" }),

    title: text("title").notNull(),
    description: text("description").notNull(),
    listingType: listingType("listing_type").notNull(),
    category: propertyCategory("category").notNull(),
    /** Commercial subtype (office, retail, ...) or residential style (bungalow, maisonette, ...). */
    subtype: text("subtype"),

    /** Whole shillings. */
    priceKes: bigint("price_kes", { mode: "number" }).notNull(),
    rentPeriod: rentPeriod("rent_period"),

    bedrooms: integer("bedrooms"),
    /** Allows half baths (e.g. 2.5). */
    bathrooms: numeric("bathrooms", { precision: 4, scale: 1, mode: "number" }),
    /** Built / floor area in square metres. */
    areaSqm: numeric("area_sqm", { precision: 12, scale: 2, mode: "number" }),
    landSize: numeric("land_size", { precision: 12, scale: 2, mode: "number" }),
    landSizeUnit: landSizeUnit("land_size_unit"),
    furnished: boolean("furnished").notNull().default(false),
    parkingSpaces: integer("parking_spaces"),
    amenities: text("amenities")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Commercial listings: permitted use / zoning notes as declared by the lister. */
    zoningNotes: text("zoning_notes"),

    county: text("county").notNull(),
    town: text("town").notNull(),
    neighbourhood: text("neighbourhood"),
    addressLabel: text("address_label"),
    /** Approximate point for public maps (neighbourhood level unless the lister opts in). */
    publicLatitude: doublePrecision("public_latitude"),
    publicLongitude: doublePrecision("public_longitude"),
    /** Never returned by public queries. */
    exactLatitude: doublePrecision("exact_latitude"),
    exactLongitude: doublePrecision("exact_longitude"),
    showExactLocation: boolean("show_exact_location").notNull().default(false),

    status: listingStatus("status").notNull().default("draft"),
    rejectionReason: text("rejection_reason"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** e.g. "plan_lapsed", "over_plan_limit". Set by billing jobs, cleared on restore. */
    pauseReason: text("pause_reason"),
    ...timestamps,
  },
  (t) => [
    check("properties_price_range", sql`${t.priceKes} >= 0 and ${t.priceKes} <= ${sql.raw(MAX_SAFE_INTEGER)}`),
    check("properties_area_positive", sql`${t.areaSqm} is null or ${t.areaSqm} > 0`),
    check("properties_land_size_positive", sql`${t.landSize} is null or ${t.landSize} > 0`),
    check(
      "properties_land_size_has_unit",
      sql`(${t.landSize} is null) = (${t.landSizeUnit} is null)`,
    ),
    check("properties_bedrooms_nonneg", sql`${t.bedrooms} is null or ${t.bedrooms} >= 0`),
    check("properties_bathrooms_nonneg", sql`${t.bathrooms} is null or ${t.bathrooms} >= 0`),
    check("properties_parking_nonneg", sql`${t.parkingSpaces} is null or ${t.parkingSpaces} >= 0`),
    check(
      "properties_rent_period_only_for_rent",
      sql`(${t.listingType} = 'rent') = (${t.rentPeriod} is not null)`,
    ),
    check(
      "properties_coords_valid",
      sql`(${t.publicLatitude} is null or ${t.publicLatitude} between -90 and 90)
        and (${t.publicLongitude} is null or ${t.publicLongitude} between -180 and 180)
        and (${t.exactLatitude} is null or ${t.exactLatitude} between -90 and 90)
        and (${t.exactLongitude} is null or ${t.exactLongitude} between -180 and 180)`,
    ),
    index("properties_public_search_idx").on(
      t.status,
      t.listingType,
      t.category,
      t.county,
      t.town,
      t.priceKes,
    ),
    index("properties_owner_idx").on(t.ownerUserId),
    index("properties_agency_idx").on(t.agencyId),
    index("properties_published_idx").on(t.publishedAt.desc()),
    // Map-bounds queries; PostGIS replaces this in Phase 3.
    index("properties_public_coords_idx").on(t.publicLatitude, t.publicLongitude),
    index("properties_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("properties_town_trgm_idx").using("gin", t.town.op("gin_trgm_ops")),
  ],
);

export const propertyImages = pgTable(
  "property_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    altText: text("alt_text").notNull(),
    width: integer("width"),
    height: integer("height"),
    sortOrder: integer("sort_order").notNull().default(0),
    isCover: boolean("is_cover").notNull().default(false),
    createdAt,
  },
  (t) => [
    index("property_images_property_sort_idx").on(t.propertyId, t.sortOrder),
    uniqueIndex("property_images_one_cover").on(t.propertyId).where(sql`${t.isCover}`),
    check("property_images_alt_text_present", sql`char_length(trim(${t.altText})) > 0`),
  ],
);

export const favorites = pgTable(
  "favorites",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.propertyId] }),
    index("favorites_property_idx").on(t.propertyId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Inquiries, conversations, messages                                         */
/* -------------------------------------------------------------------------- */

/** Contact-lister form submissions (Phase 1); kept alongside in-app chat later. */
export const inquiries = pgTable(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id")
      .notNull()
      .references(() => users.id),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id),
    fullName: text("full_name").notNull(),
    /** E.164 */
    phone: text("phone"),
    email: text("email"),
    message: text("message").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    check("inquiries_message_length", sql`char_length(${t.message}) between 1 and 5000`),
    check("inquiries_has_contact", sql`${t.phone} is not null or ${t.email} is not null`),
    index("inquiries_recipient_idx").on(t.recipientUserId, t.createdAt.desc()),
    index("inquiries_sender_property_idx").on(t.senderUserId, t.propertyId),
  ],
);

/** Phase 2: in-app conversations. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    buyerUserId: text("buyer_user_id")
      .notNull()
      .references(() => users.id),
    listerUserId: text("lister_user_id")
      .notNull()
      .references(() => users.id),
    createdAt,
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("conversations_unique_participants").on(t.propertyId, t.buyerUserId, t.listerUserId),
    check("conversations_distinct_participants", sql`${t.buyerUserId} <> ${t.listerUserId}`),
    index("conversations_buyer_recent_idx").on(t.buyerUserId, t.lastMessageAt.desc()),
    index("conversations_lister_recent_idx").on(t.listerUserId, t.lastMessageAt.desc()),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id")
      .notNull()
      .references(() => users.id),
    /** Plain text only, never rendered as HTML. */
    body: text("body").notNull(),
    createdAt,
    readAt: timestamp("read_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
  },
  (t) => [
    check("messages_body_length", sql`char_length(${t.body}) between 1 and 5000`),
    index("messages_conversation_recent_idx").on(t.conversationId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Verification (Phase 2 workflow; tables exist from the start)               */
/* -------------------------------------------------------------------------- */

/**
 * One row per paid review. The badge is derived (S2) from the latest `verified` request whose
 * review has not expired, plus active verification and listing subscriptions.
 */
export const verificationRequests = pgTable(
  "verification_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listerUserId: text("lister_user_id")
      .notNull()
      .references(() => users.id),
    status: verificationStatus("status").notNull().default("payment_pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by").references(() => users.id),
    decisionReason: text("decision_reason"),
    /** A passed review is valid for 12 months (plan §4). */
    reviewExpiresAt: timestamp("review_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("verification_requests_lister_idx").on(t.listerUserId, t.createdAt.desc()),
    index("verification_requests_status_idx").on(t.status, t.submittedAt),
    check(
      "verification_requests_verified_has_expiry",
      sql`${t.status} <> 'verified' or (${t.decidedAt} is not null and ${t.reviewExpiresAt} is not null)`,
    ),
  ],
);

/** Files live in the PRIVATE bucket; only the storage key is stored. Never served publicly. */
export const verificationDocuments = pgTable(
  "verification_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => verificationRequests.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    documentType: text("document_type").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_documents_request_idx").on(t.requestId)],
);

/** Append-only (enforced by trigger): submit, pay, view document, approve, reject, suspend, expire. */
export const verificationAuditLog = pgTable(
  "verification_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => verificationRequests.id),
    actorUserId: text("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    reason: text("reason"),
    createdAt,
  },
  (t) => [index("verification_audit_log_request_idx").on(t.requestId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Moderation and reports                                                     */
/* -------------------------------------------------------------------------- */

/** Append-only (enforced by trigger): approve, reject, take down, restore. */
export const listingModerationLog = pgTable(
  "listing_moderation_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    reason: text("reason"),
    /** Set when the action resolved an abuse report. */
    reportId: uuid("report_id"),
    createdAt,
  },
  (t) => [index("listing_moderation_log_property_idx").on(t.propertyId, t.createdAt.desc())],
);

export const listingReports = pgTable(
  "listing_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    reporterUserId: text("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    details: text("details"),
    status: reportStatus("status").notNull().default("open"),
    resolvedBy: text("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    check(
      "listing_reports_details_length",
      sql`${t.details} is null or char_length(${t.details}) <= 2000`,
    ),
    index("listing_reports_status_idx").on(t.status, t.createdAt.desc()),
    // One unresolved report per person per listing.
    uniqueIndex("listing_reports_one_open_per_reporter")
      .on(t.propertyId, t.reporterUserId)
      .where(sql`${t.status} in ('open', 'reviewing')`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Billing (plan v2.0 §4, §6)                                                 */
/* -------------------------------------------------------------------------- */

export const planKind = pgEnum("plan_kind", ["listing", "verification"]);

export const subscriptionStatus = pgEnum("subscription_status", [
  "pending",
  "active",
  "past_due",
  "paused",
  "cancelled",
  "expired",
]);

export const invoiceStatus = pgEnum("invoice_status", ["open", "paid", "void", "refunded"]);

/** `flagged`: amount mismatch or other anomaly; never activates anything. */
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "confirmed",
  "failed",
  "cancelled",
  "flagged",
]);

/** `card`: Visa or Mastercard through Paystack's hosted checkout (prompt S6 decision 14). */
export const paymentMethod = pgEnum("payment_method", ["stk_push", "c2b_paybill", "manual", "card"]);

/**
 * Feeds invoice numbers: VPK + 7 digits fits Daraja's 12-character account reference. Capped at
 * 7 digits so it errors when exhausted instead of lpad() silently truncating into duplicates.
 */
export const invoiceNumberSeq = pgSequence("invoice_number_seq", { maxValue: 9_999_999 });

/** Statuses that hold a subscription's place; at most one such row per owner and kind. */
const LIVE_SUBSCRIPTION_STATUSES = sql.raw(`('pending', 'active', 'past_due', 'paused')`);

/**
 * Versioned plans. Terms (code, version, kind, price, limit, agency flag) are immutable by
 * trigger; a price change is a new version. Only `name` and `is_active` may be updated.
 */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    version: integer("version").notNull().default(1),
    kind: planKind("kind").notNull(),
    name: text("name").notNull(),
    /** Whole shillings per 30-day period. */
    priceKes: integer("price_kes").notNull(),
    /** Active listings allowed; null for verification plans. */
    listingLimit: integer("listing_limit"),
    /** Bought by an agency; the limit is shared across its members. */
    isAgencyPlan: boolean("is_agency_plan").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("plans_code_version_unique").on(t.code, t.version),
    // Target of the subscriptions (plan_id, kind) foreign key.
    unique("plans_id_kind_unique").on(t.id, t.kind),
    uniqueIndex("plans_one_active_version").on(t.code).where(sql`${t.isActive}`),
    check("plans_price_nonneg", sql`${t.priceKes} >= 0`),
    check("plans_limit_only_for_listing", sql`(${t.kind} = 'listing') = (${t.listingLimit} is not null)`),
    check("plans_limit_positive", sql`${t.listingLimit} is null or ${t.listingLimit} > 0`),
    check("plans_agency_is_listing", sql`not ${t.isAgencyPlan} or ${t.kind} = 'listing'`),
  ],
);

/**
 * One row per owner and kind while live; renewals extend the period and add an invoice.
 * Owned by a lister (user) or, for agency listing plans, by an agency.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id").references(() => users.id),
    ownerAgencyId: uuid("owner_agency_id").references(() => agencies.id),
    /** Mirrors the plan's kind; kept in step by the composite foreign key. */
    kind: planKind("kind").notNull(),
    planId: uuid("plan_id").notNull(),
    status: subscriptionStatus("status").notNull().default("pending"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /**
     * A downgrade waiting for the period end (prompt S6 decision 3). From `scheduledChangeAt` the
     * scheduled plan is the effective one; S9 later writes it into `planId`.
     */
    scheduledPlanId: uuid("scheduled_plan_id"),
    scheduledChangeAt: timestamp("scheduled_change_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "subscriptions_plan_kind_fk",
      columns: [t.planId, t.kind],
      foreignColumns: [plans.id, plans.kind],
    }),
    foreignKey({
      name: "subscriptions_scheduled_plan_kind_fk",
      columns: [t.scheduledPlanId, t.kind],
      foreignColumns: [plans.id, plans.kind],
    }),
    check(
      "subscriptions_schedule_complete",
      sql`(${t.scheduledPlanId} is null) = (${t.scheduledChangeAt} is null)`,
    ),
    check(
      "subscriptions_schedule_changes_plan",
      sql`${t.scheduledPlanId} is null or ${t.scheduledPlanId} <> ${t.planId}`,
    ),
    check("subscriptions_one_owner", sql`(${t.ownerUserId} is null) <> (${t.ownerAgencyId} is null)`),
    check(
      "subscriptions_agency_owns_listing_only",
      sql`${t.kind} = 'listing' or ${t.ownerAgencyId} is null`,
    ),
    check(
      "subscriptions_period_valid",
      sql`(${t.currentPeriodStart} is null and ${t.currentPeriodEnd} is null and ${t.graceEndsAt} is null)
        or (${t.currentPeriodStart} is not null and ${t.currentPeriodEnd} > ${t.currentPeriodStart}
          and ${t.graceEndsAt} >= ${t.currentPeriodEnd})`,
    ),
    check(
      "subscriptions_paid_status_has_period",
      sql`${t.status} not in ('active', 'past_due', 'paused') or ${t.currentPeriodEnd} is not null`,
    ),
    uniqueIndex("subscriptions_one_live_per_user")
      .on(t.ownerUserId, t.kind)
      .where(sql`${t.ownerUserId} is not null and ${t.status} in ${LIVE_SUBSCRIPTION_STATUSES}`),
    uniqueIndex("subscriptions_one_live_per_agency")
      .on(t.ownerAgencyId, t.kind)
      .where(sql`${t.ownerAgencyId} is not null and ${t.status} in ${LIVE_SUBSCRIPTION_STATUSES}`),
    index("subscriptions_status_grace_idx").on(t.status, t.graceEndsAt),
  ],
);

/** Amount and plan are copied from `plans` at creation and are immutable by trigger. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceNumber: text("invoice_number")
      .notNull()
      .unique()
      .default(sql`'VPK' || lpad(nextval('invoice_number_seq')::text, 7, '0')`),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    amountKes: integer("amount_kes").notNull(),
    status: invoiceStatus("status").notNull().default("open"),
    /** The 30 days this invoice paid for; set when the payment is confirmed. */
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("invoices_amount_positive", sql`${t.amountKes} > 0`),
    check("invoices_number_format", sql`${t.invoiceNumber} ~ '^VPK[0-9]{7,9}$'`),
    check(
      "invoices_period_valid",
      sql`(${t.periodStart} is null and ${t.periodEnd} is null)
        or (${t.periodStart} is not null and ${t.periodEnd} > ${t.periodStart})`,
    ),
    check(
      "invoices_paid_has_period",
      sql`${t.status} <> 'paid' or (${t.paidAt} is not null and ${t.periodStart} is not null)`,
    ),
    index("invoices_subscription_idx").on(t.subscriptionId, t.createdAt.desc()),
  ],
);

/**
 * One row per STK Push attempt or Paybill payment. CheckoutRequestID and the M-Pesa receipt are
 * unique, so a repeated callback cannot create or confirm a second payment.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    method: paymentMethod("method").notNull(),
    /** E.164; mask before logging. */
    phoneE164: text("phone_e164"),
    checkoutRequestId: text("checkout_request_id").unique(),
    merchantRequestId: text("merchant_request_id"),
    mpesaReceipt: text("mpesa_receipt").unique(),
    /** The card gateway's transaction reference (Paystack `reference`); our own, set at start. */
    providerReference: text("provider_reference").unique(),
    /** Display only, from the gateway's Verify response; the gateway keeps the card. */
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    /** Amount requested, copied from the invoice. */
    amountKes: integer("amount_kes").notNull(),
    /** Amount Safaricom reports as paid. */
    paidAmountKes: integer("paid_amount_kes"),
    status: paymentStatus("status").notNull().default("pending"),
    resultCode: integer("result_code"),
    resultDesc: text("result_desc"),
    flagReason: text("flag_reason"),
    rawCallback: jsonb("raw_callback"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("payments_amount_nonneg", sql`${t.amountKes} >= 0`),
    check("payments_paid_amount_nonneg", sql`${t.paidAmountKes} is null or ${t.paidAmountKes} >= 0`),
    check(
      "payments_stk_has_checkout_id",
      sql`${t.method} <> 'stk_push' or ${t.checkoutRequestId} is not null`,
    ),
    check(
      "payments_confirmed_has_receipt",
      sql`${t.status} <> 'confirmed' or (${t.confirmedAt} is not null and (${t.mpesaReceipt} is not null or ${t.providerReference} is not null))`,
    ),
    // Compared as text: a new enum value cannot be used as a literal in the migration that adds it.
    check("payments_card_has_reference", sql`${t.method}::text <> 'card' or ${t.providerReference} is not null`),
    check("payments_card_last4_format", sql`${t.cardLast4} is null or ${t.cardLast4} ~ '^[0-9]{4}$'`),
    check("payments_flagged_has_reason", sql`${t.status} <> 'flagged' or ${t.flagReason} is not null`),
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_phone_idx").on(t.phoneE164),
  ],
);

/**
 * Append-only (enforced by trigger): every callback, query result and status change, including
 * callbacks that match no payment, for reconciliation and disputes.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id").references(() => payments.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    /** stk_callback, stk_query, c2b_validation, c2b_confirmation, status_change, reconciliation */
    eventType: text("event_type").notNull(),
    sourceIp: text("source_ip"),
    payload: jsonb("payload").notNull(),
    createdAt,
  },
  (t) => [
    index("payment_events_payment_idx").on(t.paymentId, t.createdAt),
    index("payment_events_invoice_idx").on(t.invoiceId, t.createdAt),
  ],
);

/**
 * Renewal reminders (prompt S9 decision 8): one row per subscription, period end, reminder and
 * channel, claimed before sending so a retried or overlapping job never sends twice. Not a payment
 * record, so not append-only: the status moves pending → sent / failed / skipped.
 */
export const billingReminders = pgTable(
  "billing_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** "5d" or "1d" before the period end. */
    reminder: text("reminder").notNull(),
    /** "email" or "sms". */
    channel: text("channel").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(1),
    /** The error's name only, never its message. */
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("billing_reminders_once").on(t.subscriptionId, t.periodEnd, t.reminder, t.channel),
    check("billing_reminders_reminder_valid", sql`${t.reminder} in ('5d', '1d')`),
    check("billing_reminders_channel_valid", sql`${t.channel} in ('email', 'sms')`),
    check("billing_reminders_status_valid", sql`${t.status} in ('pending', 'sent', 'failed', 'skipped')`),
    check("billing_reminders_attempts_positive", sql`${t.attempts} >= 1`),
    check("billing_reminders_error_length", sql`${t.lastError} is null or char_length(${t.lastError}) <= 100`),
  ],
);

/** Append-only (enforced by trigger): refunds, credits, manual activations; who, when and why. */
export const billingAuditLog = pgTable(
  "billing_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    amountKes: integer("amount_kes"),
    reason: text("reason").notNull(),
    createdAt,
  },
  (t) => [
    check("billing_audit_log_amount_nonneg", sql`${t.amountKes} is null or ${t.amountKes} >= 0`),
    check("billing_audit_log_reason_present", sql`char_length(trim(${t.reason})) > 0`),
    index("billing_audit_log_created_idx").on(t.createdAt.desc()),
  ],
);
