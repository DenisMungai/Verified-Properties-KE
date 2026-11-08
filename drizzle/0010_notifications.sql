CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "job_runs_job_length" CHECK (char_length("job_runs"."job") between 1 and 40),
	CONSTRAINT "job_runs_status_valid" CHECK ("job_runs"."status" in ('running', 'ok', 'skipped', 'failed')),
	CONSTRAINT "job_runs_duration_nonneg" CHECK ("job_runs"."duration_ms" is null or "job_runs"."duration_ms" >= 0),
	CONSTRAINT "job_runs_error_length" CHECK ("job_runs"."error" is null or char_length("job_runs"."error") <= 100)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_once" UNIQUE("kind","ref","recipient_user_id","channel"),
	CONSTRAINT "notification_deliveries_kind_valid" CHECK ("notification_deliveries"."kind" in ('message_alert', 'payment_receipt', 'review_digest')),
	CONSTRAINT "notification_deliveries_ref_length" CHECK (char_length("notification_deliveries"."ref") between 1 and 64),
	CONSTRAINT "notification_deliveries_channel_valid" CHECK ("notification_deliveries"."channel" in ('email')),
	CONSTRAINT "notification_deliveries_status_valid" CHECK ("notification_deliveries"."status" in ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "notification_deliveries_attempts_positive" CHECK ("notification_deliveries"."attempts" >= 1),
	CONSTRAINT "notification_deliveries_error_length" CHECK ("notification_deliveries"."last_error" is null or char_length("notification_deliveries"."last_error") <= 100)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "job_runs_status_started_idx" ON "job_runs" USING btree ("status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_deliveries_retry_idx" ON "notification_deliveries" USING btree ("updated_at") WHERE "notification_deliveries"."status" in ('failed', 'pending');--> statement-breakpoint
CREATE INDEX "notification_deliveries_created_idx" ON "notification_deliveries" USING btree ("created_at");