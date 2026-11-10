CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"details" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_requests_kind_valid" CHECK ("data_requests"."kind" in ('access', 'correction', 'deletion', 'objection', 'billing', 'other')),
	CONSTRAINT "data_requests_status_valid" CHECK ("data_requests"."status" in ('open', 'closed')),
	CONSTRAINT "data_requests_details_length" CHECK (char_length("data_requests"."details") between 10 and 2000),
	CONSTRAINT "data_requests_note_length" CHECK ("data_requests"."resolution_note" is null or char_length("data_requests"."resolution_note") between 1 and 1000),
	CONSTRAINT "data_requests_closed_complete" CHECK (("data_requests"."status" = 'closed') = ("data_requests"."closed_by" is not null and "data_requests"."closed_at" is not null and "data_requests"."resolution_note" is not null))
);
--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_requests_status_created_idx" ON "data_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "data_requests_user_idx" ON "data_requests" USING btree ("user_id","created_at" DESC NULLS LAST);