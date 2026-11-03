CREATE TABLE IF NOT EXISTS "timeline_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"timeline_id" integer NOT NULL,
	"track_kind" text DEFAULT 'video' NOT NULL,
	"track_index" integer DEFAULT 1 NOT NULL,
	"clip_id" text DEFAULT '',
	"clip_name" text DEFAULT '',
	"enabled" boolean DEFAULT true,
	"start_frame" integer DEFAULT 0 NOT NULL,
	"end_frame" integer DEFAULT 0 NOT NULL,
	"in_frame" integer DEFAULT 0,
	"out_frame" integer DEFAULT 0,
	"start_seconds" real,
	"end_seconds" real,
	"source_kind" text DEFAULT 'file',
	"source_key" text DEFAULT '',
	"source_name" text DEFAULT '',
	"source_path" text DEFAULT '',
	"matched_asset_type" text,
	"matched_asset_id" integer,
	"match_method" text DEFAULT 'unmatched',
	"match_confidence" real DEFAULT 0,
	"origin_class" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timelines" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"produced_asset_id" integer,
	"source_format" text DEFAULT 'xmeml' NOT NULL,
	"source_format_version" text DEFAULT '',
	"source_file_name" text DEFAULT '',
	"source_file_path" text DEFAULT '',
	"source_file_hash" text DEFAULT '',
	"sequence_name" text DEFAULT '',
	"timebase" integer DEFAULT 0,
	"ntsc" boolean DEFAULT false,
	"fps" real,
	"duration_frames" integer DEFAULT 0,
	"width" integer DEFAULT 0,
	"height" integer DEFAULT 0,
	"primary_track_index" integer DEFAULT 1,
	"include_overlays" boolean DEFAULT false,
	"breakdown_json" text DEFAULT '{}',
	"notes_json" text DEFAULT '[]',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_segments_timeline_id_timelines_id_fk') THEN ALTER TABLE "timeline_segments" ADD CONSTRAINT "timeline_segments_timeline_id_timelines_id_fk" FOREIGN KEY ("timeline_id") REFERENCES "public"."timelines"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timelines_project_id_projects_id_fk') THEN ALTER TABLE "timelines" ADD CONSTRAINT "timelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timelines_produced_asset_id_produced_assets_id_fk') THEN ALTER TABLE "timelines" ADD CONSTRAINT "timelines_produced_asset_id_produced_assets_id_fk" FOREIGN KEY ("produced_asset_id") REFERENCES "public"."produced_assets"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;