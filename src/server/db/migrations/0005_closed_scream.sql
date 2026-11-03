ALTER TABLE "asset_relationships" DROP CONSTRAINT IF EXISTS "asset_relationships_parent_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_relationships" DROP CONSTRAINT IF EXISTS "asset_relationships_child_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "origin_class" text DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "origin_class_confirmed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "origin_class_source" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN IF NOT EXISTS "origin_ingredient_classes" text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "asset_relationships" ADD COLUMN IF NOT EXISTS "parent_asset_type" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_relationships" ADD COLUMN IF NOT EXISTS "child_asset_type" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_relationships" ADD COLUMN IF NOT EXISTS "match_method" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_relationships" ADD COLUMN IF NOT EXISTS "confidence" real DEFAULT 1;--> statement-breakpoint
ALTER TABLE "asset_relationships" ADD COLUMN IF NOT EXISTS "notes" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "origin_class" text DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "origin_class_confirmed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "origin_class_source" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "origin_ingredient_classes" text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "frame_rate" real;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "width" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "height" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "container" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "video_codec" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "audio_codec" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "capture_signed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "origin_class" text DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "origin_class_confirmed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "origin_class_source" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD COLUMN IF NOT EXISTS "origin_ingredient_classes" text DEFAULT '[]';