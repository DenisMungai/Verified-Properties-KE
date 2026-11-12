ALTER TABLE "agencies" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "lister_profiles" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_public_phone_format" CHECK ("agencies"."public_phone" is null or "agencies"."public_phone" ~ '^\+254[17][0-9]{8}$');--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_whatsapp_format" CHECK ("agencies"."whatsapp" is null or "agencies"."whatsapp" ~ '^\+254[17][0-9]{8}$');--> statement-breakpoint
ALTER TABLE "lister_profiles" ADD CONSTRAINT "lister_profiles_whatsapp_format" CHECK ("lister_profiles"."whatsapp" is null or "lister_profiles"."whatsapp" ~ '^\+254[17][0-9]{8}$');