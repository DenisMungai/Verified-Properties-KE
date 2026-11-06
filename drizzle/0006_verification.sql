ALTER TYPE "public"."verification_status" ADD VALUE 'documents_pending' BEFORE 'under_review';--> statement-breakpoint
ALTER TABLE "verification_documents" ADD COLUMN "file_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD COLUMN "content_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD COLUMN "size_bytes" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_requests_one_open_idx" ON "verification_requests" USING btree ("lister_user_id") WHERE "verification_requests"."status" not in ('unverified', 'verified', 'rejected', 'expired', 'suspended');--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_storage_key_unique" UNIQUE("storage_key");--> statement-breakpoint
ALTER TABLE "verification_audit_log" ADD CONSTRAINT "verification_audit_log_action_valid" CHECK ("verification_audit_log"."action" in ('start', 'pay', 'upload', 'remove_document', 'submit', 'view_document', 'request_changes', 'approve', 'reject', 'suspend', 'credit', 'credit_skipped'));--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_type_valid" CHECK ("verification_documents"."document_type" in ('national_id', 'earb_certificate', 'business_registration'));--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_content_type_valid" CHECK ("verification_documents"."content_type" in ('application/pdf', 'image/jpeg', 'image/png'));--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_size_range" CHECK ("verification_documents"."size_bytes" between 1 and 10485760);--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_file_name_length" CHECK (char_length("verification_documents"."file_name") between 1 and 120);