CREATE TABLE "message_moderation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"report_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reporter_user_id" text,
	"reason" text NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reports_details_length" CHECK ("message_reports"."details" is null or char_length("message_reports"."details") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_user_id_blocked_user_id_pk" PRIMARY KEY("blocker_user_id","blocked_user_id"),
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."blocker_user_id" <> "user_blocks"."blocked_user_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "closed_by" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "removed_by" text;--> statement-breakpoint
ALTER TABLE "message_moderation_log" ADD CONSTRAINT "message_moderation_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_moderation_log" ADD CONSTRAINT "message_moderation_log_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_moderation_log" ADD CONSTRAINT "message_moderation_log_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_moderation_log" ADD CONSTRAINT "message_moderation_log_report_id_message_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."message_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_users_id_fk" FOREIGN KEY ("blocker_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_users_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_moderation_log_conversation_idx" ON "message_moderation_log" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_reports_status_idx" ON "message_reports" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "message_reports_one_open_per_reporter" ON "message_reports" USING btree ("message_id","reporter_user_id") WHERE "message_reports"."status" in ('open', 'reviewing');--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_user_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_unread_idx" ON "messages" USING btree ("conversation_id") WHERE "messages"."read_at" is null;--> statement-breakpoint
-- Append-only moderation log for conversations (prompt S15 decision 13).
CREATE TRIGGER "message_moderation_log_append_only" BEFORE UPDATE OR DELETE ON "message_moderation_log"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_change"();
--> statement-breakpoint
-- Backfill (prompt S15 decision 6): every S8 inquiry becomes a conversation and a message, keeping
-- its time and read state. Safe to run twice.
INSERT INTO "conversations" ("property_id", "buyer_user_id", "lister_user_id", "created_at", "last_message_at")
SELECT "property_id", "sender_user_id", "recipient_user_id", min("created_at"), max("created_at")
FROM "inquiries"
WHERE "sender_user_id" <> "recipient_user_id"
GROUP BY "property_id", "sender_user_id", "recipient_user_id"
ON CONFLICT ("property_id", "buyer_user_id", "lister_user_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "messages" ("conversation_id", "sender_user_id", "body", "created_at", "read_at")
SELECT c."id", i."sender_user_id", i."message", i."created_at", i."read_at"
FROM "inquiries" i
JOIN "conversations" c
  ON c."property_id" = i."property_id" AND c."buyer_user_id" = i."sender_user_id" AND c."lister_user_id" = i."recipient_user_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "messages" m
  WHERE m."conversation_id" = c."id" AND m."sender_user_id" = i."sender_user_id"
    AND m."created_at" = i."created_at" AND m."body" = i."message"
);
--> statement-breakpoint
UPDATE "conversations" c
SET "last_message_at" = latest."at"
FROM (SELECT "conversation_id", max("created_at") AS "at" FROM "messages" GROUP BY "conversation_id") latest
WHERE latest."conversation_id" = c."id" AND c."last_message_at" < latest."at";
