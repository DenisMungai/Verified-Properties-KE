ALTER TYPE "public"."payment_status" ADD VALUE 'refunded';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'credited';--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD COLUMN "credit_days" integer;--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_reference_length" CHECK ("billing_audit_log"."reference" is null or char_length("billing_audit_log"."reference") <= 100);--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_credit_days_range" CHECK ("billing_audit_log"."credit_days" is null or "billing_audit_log"."credit_days" between 1 and 365);