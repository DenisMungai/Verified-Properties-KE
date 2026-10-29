CREATE TYPE "public"."invoice_status" AS ENUM('open', 'paid', 'void', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('stk_push', 'c2b_paybill', 'manual');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'failed', 'cancelled', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."plan_kind" AS ENUM('listing', 'verification');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending', 'active', 'past_due', 'paused', 'cancelled', 'expired');--> statement-breakpoint
CREATE SEQUENCE "public"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "billing_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"subscription_id" uuid,
	"invoice_id" uuid,
	"payment_id" uuid,
	"amount_kes" integer,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_audit_log_amount_nonneg" CHECK ("billing_audit_log"."amount_kes" is null or "billing_audit_log"."amount_kes" >= 0),
	CONSTRAINT "billing_audit_log_reason_present" CHECK (char_length(trim("billing_audit_log"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text DEFAULT 'VPK' || lpad(nextval('invoice_number_seq')::text, 7, '0') NOT NULL,
	"subscription_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"amount_kes" integer NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_amount_positive" CHECK ("invoices"."amount_kes" > 0),
	CONSTRAINT "invoices_number_format" CHECK ("invoices"."invoice_number" ~ '^VPK[0-9]{7,9}$'),
	CONSTRAINT "invoices_period_valid" CHECK (("invoices"."period_start" is null and "invoices"."period_end" is null)
        or ("invoices"."period_start" is not null and "invoices"."period_end" > "invoices"."period_start")),
	CONSTRAINT "invoices_paid_has_period" CHECK ("invoices"."status" <> 'paid' or ("invoices"."paid_at" is not null and "invoices"."period_start" is not null))
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"invoice_id" uuid,
	"event_type" text NOT NULL,
	"source_ip" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"phone_e164" text,
	"checkout_request_id" text,
	"merchant_request_id" text,
	"mpesa_receipt" text,
	"amount_kes" integer NOT NULL,
	"paid_amount_kes" integer,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"result_code" integer,
	"result_desc" text,
	"flag_reason" text,
	"raw_callback" jsonb,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_checkout_request_id_unique" UNIQUE("checkout_request_id"),
	CONSTRAINT "payments_mpesa_receipt_unique" UNIQUE("mpesa_receipt"),
	CONSTRAINT "payments_amount_nonneg" CHECK ("payments"."amount_kes" >= 0),
	CONSTRAINT "payments_paid_amount_nonneg" CHECK ("payments"."paid_amount_kes" is null or "payments"."paid_amount_kes" >= 0),
	CONSTRAINT "payments_stk_has_checkout_id" CHECK ("payments"."method" <> 'stk_push' or "payments"."checkout_request_id" is not null),
	CONSTRAINT "payments_confirmed_has_receipt" CHECK ("payments"."status" <> 'confirmed' or ("payments"."mpesa_receipt" is not null and "payments"."confirmed_at" is not null)),
	CONSTRAINT "payments_flagged_has_reason" CHECK ("payments"."status" <> 'flagged' or "payments"."flag_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" "plan_kind" NOT NULL,
	"name" text NOT NULL,
	"price_kes" integer NOT NULL,
	"listing_limit" integer,
	"is_agency_plan" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_version_unique" UNIQUE("code","version"),
	CONSTRAINT "plans_id_kind_unique" UNIQUE("id","kind"),
	CONSTRAINT "plans_price_nonneg" CHECK ("plans"."price_kes" >= 0),
	CONSTRAINT "plans_limit_only_for_listing" CHECK (("plans"."kind" = 'listing') = ("plans"."listing_limit" is not null)),
	CONSTRAINT "plans_limit_positive" CHECK ("plans"."listing_limit" is null or "plans"."listing_limit" > 0),
	CONSTRAINT "plans_agency_is_listing" CHECK (not "plans"."is_agency_plan" or "plans"."kind" = 'listing')
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text,
	"owner_agency_id" uuid,
	"kind" "plan_kind" NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'pending' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_one_owner" CHECK (("subscriptions"."owner_user_id" is null) <> ("subscriptions"."owner_agency_id" is null)),
	CONSTRAINT "subscriptions_agency_owns_listing_only" CHECK ("subscriptions"."kind" = 'listing' or "subscriptions"."owner_agency_id" is null),
	CONSTRAINT "subscriptions_period_valid" CHECK (("subscriptions"."current_period_start" is null and "subscriptions"."current_period_end" is null and "subscriptions"."grace_ends_at" is null)
        or ("subscriptions"."current_period_start" is not null and "subscriptions"."current_period_end" > "subscriptions"."current_period_start"
          and "subscriptions"."grace_ends_at" >= "subscriptions"."current_period_end")),
	CONSTRAINT "subscriptions_paid_status_has_period" CHECK ("subscriptions"."status" not in ('active', 'past_due', 'paused') or "subscriptions"."current_period_end" is not null)
);
--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_agency_id_agencies_id_fk" FOREIGN KEY ("owner_agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_kind_fk" FOREIGN KEY ("plan_id","kind") REFERENCES "public"."plans"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_audit_log_created_idx" ON "billing_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_subscription_idx" ON "invoices" USING btree ("subscription_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_events_invoice_idx" ON "payment_events" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_phone_idx" ON "payments" USING btree ("phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_active_version" ON "plans" USING btree ("code") WHERE "plans"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_live_per_user" ON "subscriptions" USING btree ("owner_user_id","kind") WHERE "subscriptions"."owner_user_id" is not null and "subscriptions"."status" in ('pending', 'active', 'past_due', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_live_per_agency" ON "subscriptions" USING btree ("owner_agency_id","kind") WHERE "subscriptions"."owner_agency_id" is not null and "subscriptions"."status" in ('pending', 'active', 'past_due', 'paused');--> statement-breakpoint
CREATE INDEX "subscriptions_status_grace_idx" ON "subscriptions" USING btree ("status","grace_ends_at");
--> statement-breakpoint
-- Billing rules Drizzle does not model (plan v2.0 §4, §6). Hand-written; drizzle-kit does not
-- track anything below this line.
-- Append-only billing logs: reuse the 0001 trigger function.
CREATE TRIGGER "payment_events_append_only" BEFORE UPDATE OR DELETE ON "payment_events"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_change"();
--> statement-breakpoint
CREATE TRIGGER "billing_audit_log_append_only" BEFORE UPDATE OR DELETE ON "billing_audit_log"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_change"();
--> statement-breakpoint
-- Plan terms are immutable: a price or limit change is a new plan version. Only name and
-- is_active may change.
CREATE FUNCTION "reject_plan_terms_change"() RETURNS trigger AS $$
BEGIN
  IF (NEW.id, NEW.code, NEW.version, NEW.kind, NEW.price_kes, NEW.listing_limit, NEW.is_agency_plan)
     IS DISTINCT FROM
     (OLD.id, OLD.code, OLD.version, OLD.kind, OLD.price_kes, OLD.listing_limit, OLD.is_agency_plan) THEN
    RAISE EXCEPTION 'plan terms are immutable; add a new plan version' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "plans_terms_immutable" BEFORE UPDATE ON "plans"
FOR EACH ROW EXECUTE FUNCTION "reject_plan_terms_change"();
--> statement-breakpoint
-- Invoice terms are fixed when the invoice is created; payments are checked against them.
CREATE FUNCTION "reject_invoice_terms_change"() RETURNS trigger AS $$
BEGIN
  IF (NEW.id, NEW.invoice_number, NEW.subscription_id, NEW.plan_id, NEW.amount_kes)
     IS DISTINCT FROM
     (OLD.id, OLD.invoice_number, OLD.subscription_id, OLD.plan_id, OLD.amount_kes) THEN
    RAISE EXCEPTION 'invoice terms are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "invoices_terms_immutable" BEFORE UPDATE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION "reject_invoice_terms_change"();
--> statement-breakpoint
-- The verified badge, derived and never stored (plan v2.0 §6). A lister is verified right now
-- only when all three hold:
--   1. a passed review that has not expired (a suspension changes the request's status);
--   2. a verification subscription that is paid up or in grace;
--   3. a listing plan for their listing pool that is paid up or in grace. Agency members use the
--      agency's plan; everyone else uses their own.
-- "Paid up or in grace" = status active/past_due and now() < grace_ends_at, so a missed job
-- never keeps the badge after grace. Search ranking joins this view; the badge calls
-- lister_verified_now(). Nothing else may re-implement the rule.
CREATE VIEW "verified_listers_now" AS
WITH "in_good_standing" AS (
  SELECT "owner_user_id", "owner_agency_id", "kind"
  FROM "subscriptions"
  WHERE "status" IN ('active', 'past_due') AND "grace_ends_at" > now()
)
SELECT "lp"."user_id"
FROM "lister_profiles" "lp"
WHERE EXISTS (
    SELECT 1 FROM "verification_requests" "vr"
    WHERE "vr"."lister_user_id" = "lp"."user_id"
      AND "vr"."status" = 'verified'
      AND "vr"."review_expires_at" > now()
  )
  AND EXISTS (
    SELECT 1 FROM "in_good_standing" "s"
    WHERE "s"."kind" = 'verification' AND "s"."owner_user_id" = "lp"."user_id"
  )
  AND EXISTS (
    SELECT 1 FROM "in_good_standing" "s"
    WHERE "s"."kind" = 'listing'
      AND (
        ("lp"."agency_id" IS NOT NULL AND "s"."owner_agency_id" = "lp"."agency_id")
        OR ("lp"."agency_id" IS NULL AND "s"."owner_user_id" = "lp"."user_id")
      )
  );
--> statement-breakpoint
CREATE FUNCTION "lister_verified_now"("p_user_id" text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "verified_listers_now" WHERE "user_id" = "p_user_id");
$$;
