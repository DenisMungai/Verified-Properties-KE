CREATE TABLE "billing_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"reminder" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_reminders_once" UNIQUE("subscription_id","period_end","reminder","channel"),
	CONSTRAINT "billing_reminders_reminder_valid" CHECK ("billing_reminders"."reminder" in ('5d', '1d')),
	CONSTRAINT "billing_reminders_channel_valid" CHECK ("billing_reminders"."channel" in ('email', 'sms')),
	CONSTRAINT "billing_reminders_status_valid" CHECK ("billing_reminders"."status" in ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "billing_reminders_attempts_positive" CHECK ("billing_reminders"."attempts" >= 1),
	CONSTRAINT "billing_reminders_error_length" CHECK ("billing_reminders"."last_error" is null or char_length("billing_reminders"."last_error") <= 100)
);
--> statement-breakpoint
ALTER TABLE "billing_reminders" ADD CONSTRAINT "billing_reminders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;