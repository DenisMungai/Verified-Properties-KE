ALTER TYPE "public"."payment_method" ADD VALUE 'card';--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_confirmed_has_receipt";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_last4" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_change_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_plan_kind_fk" FOREIGN KEY ("scheduled_plan_id","kind") REFERENCES "public"."plans"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_reference_unique" UNIQUE("provider_reference");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_card_has_reference" CHECK ("payments"."method"::text <> 'card' or "payments"."provider_reference" is not null);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_card_last4_format" CHECK ("payments"."card_last4" is null or "payments"."card_last4" ~ '^[0-9]{4}$');--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_has_receipt" CHECK ("payments"."status" <> 'confirmed' or ("payments"."confirmed_at" is not null and ("payments"."mpesa_receipt" is not null or "payments"."provider_reference" is not null)));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_schedule_complete" CHECK (("subscriptions"."scheduled_plan_id" is null) = ("subscriptions"."scheduled_change_at" is null));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_schedule_changes_plan" CHECK ("subscriptions"."scheduled_plan_id" is null or "subscriptions"."scheduled_plan_id" <> "subscriptions"."plan_id");