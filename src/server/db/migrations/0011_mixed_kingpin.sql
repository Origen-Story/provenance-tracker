ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "in_place" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "in_place" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "in_place" boolean DEFAULT false;