CREATE TABLE "agency_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "agency_member_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"revoked_at" timestamp with time zone,
	"declined" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "agency_invites_email_lower" CHECK ("agency_invites"."email" = lower("agency_invites"."email") and char_length("agency_invites"."email") between 3 and 254),
	CONSTRAINT "agency_invites_token_hash_format" CHECK ("agency_invites"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_invites_one_outcome" CHECK (not ("agency_invites"."accepted_at" is not null and "agency_invites"."revoked_at" is not null))
);
--> statement-breakpoint
DROP INDEX "agency_members_user_idx";--> statement-breakpoint
ALTER TABLE "agency_invites" ADD CONSTRAINT "agency_invites_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invites" ADD CONSTRAINT "agency_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invites" ADD CONSTRAINT "agency_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_invites_one_open_per_email" ON "agency_invites" USING btree ("agency_id","email") WHERE "agency_invites"."accepted_at" is null and "agency_invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "agency_invites_email_idx" ON "agency_invites" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_members_one_agency_per_user" ON "agency_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_name_length" CHECK (char_length(trim("agencies"."name")) between 2 and 80);--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_slug_format" CHECK ("agencies"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("agencies"."slug") <= 64);--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_description_length" CHECK ("agencies"."description" is null or char_length("agencies"."description") <= 1000);--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_website_https" CHECK ("agencies"."website_url" is null or ("agencies"."website_url" ~ '^https://' and char_length("agencies"."website_url") <= 200));