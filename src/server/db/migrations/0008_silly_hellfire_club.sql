ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "ai_assisted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "signed_by" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "signer_name" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "ai_assisted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "signed_by" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "signer_name" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "ai_assisted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "signed_by" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "signer_name" text DEFAULT '';