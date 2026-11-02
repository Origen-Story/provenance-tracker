ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "original_file_path" text;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "duration_seconds" real;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "original_file_path" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "certificate_path" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "private_key_path" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cawg_identity_url" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cawg_identity_name" text DEFAULT '';