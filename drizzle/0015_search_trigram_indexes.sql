DROP INDEX "properties_title_trgm_idx";--> statement-breakpoint
CREATE INDEX "properties_county_trgm_idx" ON "properties" USING gin ("county" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "properties_neighbourhood_trgm_idx" ON "properties" USING gin ("neighbourhood" gin_trgm_ops);