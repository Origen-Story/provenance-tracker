ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "origin_class_note" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "origin_class_note" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "is_output" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "output_source" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "origin_class_note" text DEFAULT '';