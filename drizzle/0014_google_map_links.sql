ALTER TABLE "agencies" ADD COLUMN "office_map_url" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_office_map_url_https" CHECK ("agencies"."office_map_url" is null or ("agencies"."office_map_url" ~ '^https://' and char_length("agencies"."office_map_url") <= 500));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_map_url_https" CHECK ("properties"."map_url" is null or ("properties"."map_url" ~ '^https://' and char_length("properties"."map_url") <= 500));