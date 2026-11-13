CREATE TABLE IF NOT EXISTS "creator_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"produced_asset_id" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"author_name" text DEFAULT '',
	"organization" text DEFAULT '',
	"software_agent" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"asset_type" text NOT NULL,
	"asset_id" integer NOT NULL,
	"kind" text DEFAULT 'asset' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_path" text NOT NULL,
	"source_hash" text DEFAULT '',
	"signed_path" text NOT NULL,
	"signed_hash" text DEFAULT '',
	"signed_size" integer DEFAULT 0,
	"definition_json" text DEFAULT '{}',
	"report_json" text,
	"statement_json" text,
	"status" text DEFAULT '',
	"signer_name" text DEFAULT '',
	"signer_issuer" text DEFAULT '',
	"timestamped" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creator_statements_project_id_projects_id_fk') THEN ALTER TABLE "creator_statements" ADD CONSTRAINT "creator_statements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creator_statements_produced_asset_id_produced_assets_id_fk') THEN ALTER TABLE "creator_statements" ADD CONSTRAINT "creator_statements_produced_asset_id_produced_assets_id_fk" FOREIGN KEY ("produced_asset_id") REFERENCES "public"."produced_assets"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signatures_project_id_projects_id_fk') THEN ALTER TABLE "signatures" ADD CONSTRAINT "signatures_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "creator_statements_produced_asset_idx" ON "creator_statements" USING btree ("produced_asset_id");