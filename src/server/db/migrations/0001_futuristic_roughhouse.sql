CREATE TABLE "produced_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"filename" text DEFAULT '' NOT NULL,
	"file_path" text NOT NULL,
	"file_hash" text DEFAULT '',
	"file_size" integer DEFAULT 0,
	"mime_type" text DEFAULT '',
	"asset_type" text DEFAULT 'audio',
	"description" text DEFAULT '',
	"creator" text DEFAULT '',
	"recording_date" text DEFAULT '',
	"location" text DEFAULT '',
	"equipment" text DEFAULT '',
	"usage_notes" text DEFAULT '',
	"exif_json" text DEFAULT '{}',
	"c2pa_json" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "search_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"search_group_id" text DEFAULT '' NOT NULL,
	"search_group_name" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'wikimedia' NOT NULL,
	"source_page_url" text NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text DEFAULT '',
	"title" text DEFAULT '',
	"description" text DEFAULT '',
	"author" text DEFAULT '',
	"license" text DEFAULT '',
	"license_url" text DEFAULT '',
	"license_tier" text DEFAULT 'green',
	"original_date" text DEFAULT '',
	"dimensions" text DEFAULT '{}',
	"categories" text DEFAULT '[]',
	"search_query" text DEFAULT '',
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text DEFAULT '',
	"archival_asset_id" integer,
	"raw_metadata" text DEFAULT '{}',
	"retry_count" integer DEFAULT 0,
	"next_attempt_at" timestamp with time zone,
	"last_error" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "search_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"group_id" text DEFAULT '' NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"keywords" text DEFAULT '{}',
	"categories" text DEFAULT '[]',
	"notes" text DEFAULT '',
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "search_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"group_id" text DEFAULT '' NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"keywords_total" integer DEFAULT 0,
	"keywords_done" integer DEFAULT 0,
	"categories_total" integer DEFAULT 0,
	"categories_done" integer DEFAULT 0,
	"unique_titles" integer DEFAULT 0,
	"candidates_inserted" integer DEFAULT 0,
	"skipped_license" integer DEFAULT 0,
	"skipped_duplicate" integer DEFAULT 0,
	"skipped_existing" integer DEFAULT 0,
	"lease_until" timestamp with time zone,
	"last_error" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now(),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN "image_url" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN "c2pa_json" text;--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN "search_group_id" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "archival_assets" ADD COLUMN "search_group_name" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "storage_path" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "notion_group_property" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "produced_assets" ADD CONSTRAINT "produced_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_candidates" ADD CONSTRAINT "search_candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_candidates" ADD CONSTRAINT "search_candidates_archival_asset_id_archival_assets_id_fk" FOREIGN KEY ("archival_asset_id") REFERENCES "public"."archival_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_groups" ADD CONSTRAINT "search_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_jobs" ADD CONSTRAINT "search_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_groups_project_group_idx" ON "search_groups" USING btree ("project_id","group_id");