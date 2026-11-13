ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "public_title" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "public_title" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "public_title" text DEFAULT '';