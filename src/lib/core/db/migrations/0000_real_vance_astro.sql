CREATE TABLE `asset_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`metadata_type` text NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`extracted_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `asset_relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_asset_id` integer NOT NULL,
	`child_asset_id` integer NOT NULL,
	`relationship_type` text DEFAULT 'ingredient' NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`parent_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` text NOT NULL,
	`description` text DEFAULT '',
	`file_path` text NOT NULL,
	`file_hash` text DEFAULT '',
	`file_size` integer DEFAULT 0,
	`mime_type` text DEFAULT '',
	`asset_type` text DEFAULT 'other',
	`platform` text DEFAULT 'unknown',
	`digital_source_type` text DEFAULT '',
	`completeness` integer DEFAULT 0,
	`generation_date` text DEFAULT '',
	`notes` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_asset_id_unique` ON `assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `generation_params` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`prompt` text DEFAULT '',
	`negative_prompt` text DEFAULT '',
	`model_name` text DEFAULT '',
	`model_version` text DEFAULT '',
	`seed` text DEFAULT '',
	`steps` integer DEFAULT 0,
	`cfg_scale` text DEFAULT '',
	`sampler` text DEFAULT '',
	`scheduler` text DEFAULT '',
	`width` integer DEFAULT 0,
	`height` integer DEFAULT 0,
	`aspect_ratio` text DEFAULT '',
	`stylize` text DEFAULT '',
	`style_raw` text DEFAULT '',
	`loras` text DEFAULT '[]',
	`controlnets` text DEFAULT '[]',
	`other_params` text DEFAULT '{}',
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `manifests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer,
	`manifest_json` text DEFAULT '{}' NOT NULL,
	`manifest_type` text DEFAULT 'individual' NOT NULL,
	`signed_at` text DEFAULT '',
	`output_path` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `project_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_name` text DEFAULT 'Untitled Project' NOT NULL,
	`author` text DEFAULT '',
	`organization` text DEFAULT '',
	`certificate_path` text DEFAULT '',
	`private_key_path` text DEFAULT '',
	`storage_root_path` text DEFAULT '',
	`asset_id_prefix` text DEFAULT 'GAIA',
	`default_digital_source_type` text DEFAULT 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
