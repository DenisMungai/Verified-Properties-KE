CREATE TABLE "listing_view_days" (
	"property_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "listing_view_days_property_id_day_pk" PRIMARY KEY("property_id","day"),
	CONSTRAINT "listing_view_days_views_nonneg" CHECK ("listing_view_days"."views" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verification_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"reminder" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_reminders_once" UNIQUE("request_id","reminder","channel"),
	CONSTRAINT "verification_reminders_reminder_valid" CHECK ("verification_reminders"."reminder" in ('30d', '7d', 'expired')),
	CONSTRAINT "verification_reminders_channel_valid" CHECK ("verification_reminders"."channel" in ('email', 'sms')),
	CONSTRAINT "verification_reminders_status_valid" CHECK ("verification_reminders"."status" in ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "verification_reminders_attempts_positive" CHECK ("verification_reminders"."attempts" >= 1),
	CONSTRAINT "verification_reminders_error_length" CHECK ("verification_reminders"."last_error" is null or char_length("verification_reminders"."last_error") <= 100)
);
--> statement-breakpoint
ALTER TABLE "verification_audit_log" DROP CONSTRAINT "verification_audit_log_action_valid";--> statement-breakpoint
ALTER TABLE "verification_requests" ADD COLUMN "renews_request_id" uuid;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD COLUMN "documents_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_view_days" ADD CONSTRAINT "listing_view_days_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_reminders" ADD CONSTRAINT "verification_reminders_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."verification_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_renews_request_id_fk" FOREIGN KEY ("renews_request_id") REFERENCES "public"."verification_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_audit_log" ADD CONSTRAINT "verification_audit_log_action_valid" CHECK ("verification_audit_log"."action" in ('start', 'pay', 'upload', 'remove_document', 'submit', 'view_document', 'request_changes', 'approve', 'reject', 'suspend', 'credit', 'credit_skipped', 'rereview', 'expire', 'supersede', 'purge_documents'));