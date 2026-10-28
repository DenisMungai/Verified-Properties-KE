CREATE TYPE "public"."agency_member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."app_role" AS ENUM('buyer_tenant', 'owner', 'agent', 'agency_admin', 'platform_admin', 'billing_admin');--> statement-breakpoint
CREATE TYPE "public"."land_size_unit" AS ENUM('sqm', 'acre', 'hectare');--> statement-breakpoint
CREATE TYPE "public"."lister_type" AS ENUM('agent', 'owner', 'developer');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'pending_review', 'published', 'paused', 'rejected', 'rented', 'sold', 'withdrawn', 'archived');--> statement-breakpoint
CREATE TYPE "public"."listing_type" AS ENUM('sale', 'rent');--> statement-breakpoint
CREATE TYPE "public"."property_category" AS ENUM('house', 'apartment', 'land', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."rent_period" AS ENUM('week', 'month', 'year');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'payment_pending', 'under_review', 'verified', 'rejected', 'expired', 'suspended');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"logo_key" text,
	"website_url" text,
	"public_email" text,
	"public_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agency_members" (
	"agency_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "agency_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_members_agency_id_user_id_pk" PRIMARY KEY("agency_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"buyer_user_id" text NOT NULL,
	"lister_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_unique_participants" UNIQUE("property_id","buyer_user_id","lister_user_id"),
	CONSTRAINT "conversations_distinct_participants" CHECK ("conversations"."buyer_user_id" <> "conversations"."lister_user_id")
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"user_id" text NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_property_id_pk" PRIMARY KEY("user_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"sender_user_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text,
	"message" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiries_message_length" CHECK (char_length("inquiries"."message") between 1 and 5000),
	CONSTRAINT "inquiries_has_contact" CHECK ("inquiries"."phone" is not null or "inquiries"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "lister_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"lister_type" "lister_type" DEFAULT 'agent' NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"public_email" text,
	"avatar_key" text,
	"agency_id" uuid,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_moderation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reporter_user_id" text,
	"reason" text NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_reports_details_length" CHECK ("listing_reports"."details" is null or char_length("listing_reports"."details") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"agency_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"listing_type" "listing_type" NOT NULL,
	"category" "property_category" NOT NULL,
	"subtype" text,
	"price_kes" bigint NOT NULL,
	"rent_period" "rent_period",
	"bedrooms" integer,
	"bathrooms" numeric(4, 1),
	"area_sqm" numeric(12, 2),
	"land_size" numeric(12, 2),
	"land_size_unit" "land_size_unit",
	"furnished" boolean DEFAULT false NOT NULL,
	"parking_spaces" integer,
	"amenities" text[] DEFAULT '{}'::text[] NOT NULL,
	"zoning_notes" text,
	"county" text NOT NULL,
	"town" text NOT NULL,
	"neighbourhood" text,
	"address_label" text,
	"public_latitude" double precision,
	"public_longitude" double precision,
	"exact_latitude" double precision,
	"exact_longitude" double precision,
	"show_exact_location" boolean DEFAULT false NOT NULL,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"pause_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_slug_unique" UNIQUE("slug"),
	CONSTRAINT "properties_price_range" CHECK ("properties"."price_kes" >= 0 and "properties"."price_kes" <= 9007199254740991),
	CONSTRAINT "properties_area_positive" CHECK ("properties"."area_sqm" is null or "properties"."area_sqm" > 0),
	CONSTRAINT "properties_land_size_positive" CHECK ("properties"."land_size" is null or "properties"."land_size" > 0),
	CONSTRAINT "properties_land_size_has_unit" CHECK (("properties"."land_size" is null) = ("properties"."land_size_unit" is null)),
	CONSTRAINT "properties_bedrooms_nonneg" CHECK ("properties"."bedrooms" is null or "properties"."bedrooms" >= 0),
	CONSTRAINT "properties_bathrooms_nonneg" CHECK ("properties"."bathrooms" is null or "properties"."bathrooms" >= 0),
	CONSTRAINT "properties_parking_nonneg" CHECK ("properties"."parking_spaces" is null or "properties"."parking_spaces" >= 0),
	CONSTRAINT "properties_rent_period_only_for_rent" CHECK (("properties"."listing_type" = 'rent') = ("properties"."rent_period" is not null)),
	CONSTRAINT "properties_coords_valid" CHECK (("properties"."public_latitude" is null or "properties"."public_latitude" between -90 and 90)
        and ("properties"."public_longitude" is null or "properties"."public_longitude" between -180 and 180)
        and ("properties"."exact_latitude" is null or "properties"."exact_latitude" between -90 and 90)
        and ("properties"."exact_longitude" is null or "properties"."exact_longitude" between -180 and 180))
);
--> statement-breakpoint
CREATE TABLE "property_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"alt_text" text NOT NULL,
	"width" integer,
	"height" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_images_alt_text_present" CHECK (char_length(trim("property_images"."alt_text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role" "app_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"document_type" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lister_user_id" text NOT NULL,
	"status" "verification_status" DEFAULT 'payment_pending' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"decision_reason" text,
	"review_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_requests_verified_has_expiry" CHECK ("verification_requests"."status" <> 'verified' or ("verification_requests"."decided_at" is not null and "verification_requests"."review_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lister_user_id_users_id_fk" FOREIGN KEY ("lister_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lister_profiles" ADD CONSTRAINT "lister_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lister_profiles" ADD CONSTRAINT "lister_profiles_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_moderation_log" ADD CONSTRAINT "listing_moderation_log_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_moderation_log" ADD CONSTRAINT "listing_moderation_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_audit_log" ADD CONSTRAINT "verification_audit_log_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."verification_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_audit_log" ADD CONSTRAINT "verification_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_lister_user_id_users_id_fk" FOREIGN KEY ("lister_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agency_members_user_idx" ON "agency_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_buyer_recent_idx" ON "conversations" USING btree ("buyer_user_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_lister_recent_idx" ON "conversations" USING btree ("lister_user_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "favorites_property_idx" ON "favorites" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "inquiries_recipient_idx" ON "inquiries" USING btree ("recipient_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inquiries_sender_property_idx" ON "inquiries" USING btree ("sender_user_id","property_id");--> statement-breakpoint
CREATE INDEX "listing_moderation_log_property_idx" ON "listing_moderation_log" USING btree ("property_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listing_reports_status_idx" ON "listing_reports" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "listing_reports_one_open_per_reporter" ON "listing_reports" USING btree ("property_id","reporter_user_id") WHERE "listing_reports"."status" in ('open', 'reviewing');--> statement-breakpoint
CREATE INDEX "messages_conversation_recent_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "properties_public_search_idx" ON "properties" USING btree ("status","listing_type","category","county","town","price_kes");--> statement-breakpoint
CREATE INDEX "properties_owner_idx" ON "properties" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "properties_agency_idx" ON "properties" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "properties_published_idx" ON "properties" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "properties_public_coords_idx" ON "properties" USING btree ("public_latitude","public_longitude");--> statement-breakpoint
CREATE INDEX "properties_title_trgm_idx" ON "properties" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "properties_town_trgm_idx" ON "properties" USING gin ("town" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "property_images_property_sort_idx" ON "property_images" USING btree ("property_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "property_images_one_cover" ON "property_images" USING btree ("property_id") WHERE "property_images"."is_cover";--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_audit_log_request_idx" ON "verification_audit_log" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_documents_request_idx" ON "verification_documents" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "verification_requests_lister_idx" ON "verification_requests" USING btree ("lister_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "verification_requests_status_idx" ON "verification_requests" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
-- Append-only audit logs (plan v2.0 §6, §10): reject any UPDATE or DELETE.
CREATE FUNCTION "reject_audit_log_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "listing_moderation_log_append_only" BEFORE UPDATE OR DELETE ON "listing_moderation_log"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_change"();
--> statement-breakpoint
CREATE TRIGGER "verification_audit_log_append_only" BEFORE UPDATE OR DELETE ON "verification_audit_log"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_change"();
