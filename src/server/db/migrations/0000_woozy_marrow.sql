CREATE TABLE "archival_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"filename" text DEFAULT '' NOT NULL,
	"file_path" text NOT NULL,
	"file_hash" text DEFAULT '',
	"file_size" integer DEFAULT 0,
	"mime_type" text DEFAULT '',
	"source_url" text DEFAULT '',
	"access_date" text DEFAULT '',
	"creator" text DEFAULT '',
	"institution" text DEFAULT '',
	"license" text DEFAULT '',
	"license_url" text DEFAULT '',
	"caption" text DEFAULT '',
	"original_date" text DEFAULT '',
	"medium" text DEFAULT 'photograph',
	"usage_notes" text DEFAULT '',
	"exif_json" text DEFAULT '{}',
	"notion_page_id" text DEFAULT '',
	"notion_synced_at" timestamp with time zone,
	"notion_image_strategy" text DEFAULT 'external_url',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "asset_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"metadata_type" text NOT NULL,
	"raw_json" text DEFAULT '{}' NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "asset_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_asset_id" integer NOT NULL,
	"child_asset_id" integer NOT NULL,
	"relationship_type" text DEFAULT 'ingredient' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"asset_id" text NOT NULL,
	"description" text DEFAULT '',
	"file_path" text NOT NULL,
	"file_hash" text DEFAULT '',
	"file_size" integer DEFAULT 0,
	"mime_type" text DEFAULT '',
	"asset_type" text DEFAULT 'other',
	"platform" text DEFAULT 'unknown',
	"digital_source_type" text DEFAULT '',
	"completeness" integer DEFAULT 0,
	"generation_date" text DEFAULT '',
	"notes" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "assets_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "generation_params" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"prompt" text DEFAULT '',
	"negative_prompt" text DEFAULT '',
	"model_name" text DEFAULT '',
	"model_version" text DEFAULT '',
	"seed" text DEFAULT '',
	"steps" integer DEFAULT 0,
	"cfg_scale" text DEFAULT '',
	"sampler" text DEFAULT '',
	"scheduler" text DEFAULT '',
	"width" integer DEFAULT 0,
	"height" integer DEFAULT 0,
	"aspect_ratio" text DEFAULT '',
	"stylize" text DEFAULT '',
	"style_raw" text DEFAULT '',
	"loras" text DEFAULT '[]',
	"controlnets" text DEFAULT '[]',
	"other_params" text DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "manifests" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer,
	"manifest_json" text DEFAULT '{}' NOT NULL,
	"manifest_type" text DEFAULT 'individual' NOT NULL,
	"signed_at" text DEFAULT '',
	"output_path" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text DEFAULT 'Untitled Project' NOT NULL,
	"author" text DEFAULT '',
	"organization" text DEFAULT '',
	"certificate_path" text DEFAULT '',
	"private_key_path" text DEFAULT '',
	"storage_root_path" text DEFAULT '',
	"asset_id_prefix" text DEFAULT 'PROJ',
	"default_digital_source_type" text DEFAULT 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"asset_id_prefix" text DEFAULT 'PROJ' NOT NULL,
	"modules" text DEFAULT '["archival"]',
	"notion_enabled" boolean DEFAULT false,
	"notion_archival_db_id" text DEFAULT '',
	"is_active" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "archival_assets" ADD CONSTRAINT "archival_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_metadata" ADD CONSTRAINT "asset_metadata_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_relationships" ADD CONSTRAINT "asset_relationships_parent_asset_id_assets_id_fk" FOREIGN KEY ("parent_asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_relationships" ADD CONSTRAINT "asset_relationships_child_asset_id_assets_id_fk" FOREIGN KEY ("child_asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_params" ADD CONSTRAINT "generation_params_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;