import { pgTable, serial, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const projectConfig = pgTable('project_config', {
	id: serial('id').primaryKey(),
	projectName: text('project_name').notNull().default('Untitled Project'),
	author: text('author').default(''),
	organization: text('organization').default(''),
	certificatePath: text('certificate_path').default(''),
	privateKeyPath: text('private_key_path').default(''),
	storageRootPath: text('storage_root_path').default(''),
	assetIdPrefix: text('asset_id_prefix').default('PROJ'),
	defaultDigitalSourceType: text('default_digital_source_type')
		.default('http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const projects = pgTable('projects', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description').default(''),
	assetIdPrefix: text('asset_id_prefix').notNull().default('PROJ'),
	modules: text('modules').default('["archival"]'), // JSON array: "archival", "ai_assets"
	storagePath: text('storage_path').default(''),           // project-specific file storage root
	notionEnabled: boolean('notion_enabled').default(false),
	notionArchivalDbId: text('notion_archival_db_id').default(''),
	notionGroupProperty: text('notion_group_property').default(''),  // Notion select column name for search group (e.g. "Stop", "Era")
	isActive: boolean('is_active').default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const assets = pgTable('assets', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
	assetId: text('asset_id').notNull().unique(),
	description: text('description').default(''),
	filePath: text('file_path').notNull(),
	fileHash: text('file_hash').default(''),
	fileSize: integer('file_size').default(0),
	mimeType: text('mime_type').default(''),
	assetType: text('asset_type').default('other'),
	platform: text('platform').default('unknown'),
	digitalSourceType: text('digital_source_type').default(''),
	completeness: integer('completeness').default(0),
	generationDate: text('generation_date').default(''),
	notes: text('notes').default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const assetMetadata = pgTable('asset_metadata', {
	id: serial('id').primaryKey(),
	assetId: integer('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
	metadataType: text('metadata_type').notNull(),
	rawJson: text('raw_json').notNull().default('{}'),
	extractedAt: timestamp('extracted_at', { withTimezone: true }).defaultNow()
});

export const generationParams = pgTable('generation_params', {
	id: serial('id').primaryKey(),
	assetId: integer('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
	prompt: text('prompt').default(''),
	negativePrompt: text('negative_prompt').default(''),
	modelName: text('model_name').default(''),
	modelVersion: text('model_version').default(''),
	seed: text('seed').default(''),
	steps: integer('steps').default(0),
	cfgScale: text('cfg_scale').default(''),
	sampler: text('sampler').default(''),
	scheduler: text('scheduler').default(''),
	width: integer('width').default(0),
	height: integer('height').default(0),
	aspectRatio: text('aspect_ratio').default(''),
	stylize: text('stylize').default(''),
	styleRaw: text('style_raw').default(''),
	loras: text('loras').default('[]'),
	controlnets: text('controlnets').default('[]'),
	otherParams: text('other_params').default('{}'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const assetRelationships = pgTable('asset_relationships', {
	id: serial('id').primaryKey(),
	parentAssetId: integer('parent_asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
	childAssetId: integer('child_asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
	relationshipType: text('relationship_type').notNull().default('ingredient'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const manifests = pgTable('manifests', {
	id: serial('id').primaryKey(),
	assetId: integer('asset_id').references(() => assets.id, { onDelete: 'set null' }),
	manifestJson: text('manifest_json').notNull().default('{}'),
	manifestType: text('manifest_type').notNull().default('individual'),
	signedAt: text('signed_at').default(''),
	outputPath: text('output_path').default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const archivalAssets = pgTable('archival_assets', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	name: text('name').notNull().default(''),
	filename: text('filename').notNull().default(''),
	filePath: text('file_path').notNull(),
	fileHash: text('file_hash').default(''),
	fileSize: integer('file_size').default(0),
	mimeType: text('mime_type').default(''),
	sourceUrl: text('source_url').default(''),
	imageUrl: text('image_url').default(''),          // direct image file URL (for Notion, previews)
	accessDate: text('access_date').default(''),         // YYYY-MM-DD
	creator: text('creator').default(''),
	institution: text('institution').default(''),
	license: text('license').default(''),
	licenseUrl: text('license_url').default(''),
	caption: text('caption').default(''),
	originalDate: text('original_date').default(''),     // e.g. "1910", "circa 1900"
	medium: text('medium').default('photograph'),        // photograph|illustration|map|document|other
	usageNotes: text('usage_notes').default(''),
	exifJson: text('exif_json').default('{}'),
	c2paJson: text('c2pa_json'),                             // null = no manifest found
	notionPageId: text('notion_page_id').default(''),
	notionSyncedAt: timestamp('notion_synced_at', { withTimezone: true }),
	notionImageStrategy: text('notion_image_strategy').default('external_url'),
	searchGroupId: text('search_group_id').default(''),       // generic group/stop/era/chapter ID
	searchGroupName: text('search_group_name').default(''),   // human-readable group name
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const producedAssets = pgTable('produced_assets', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	name: text('name').notNull().default(''),
	filename: text('filename').notNull().default(''),
	filePath: text('file_path').notNull(),
	fileHash: text('file_hash').default(''),
	fileSize: integer('file_size').default(0),
	mimeType: text('mime_type').default(''),
	assetType: text('asset_type').default('audio'),        // audio|video|image|document|other
	description: text('description').default(''),
	creator: text('creator').default(''),
	recordingDate: text('recording_date').default(''),      // YYYY-MM-DD
	location: text('location').default(''),
	equipment: text('equipment').default(''),
	usageNotes: text('usage_notes').default(''),
	exifJson: text('exif_json').default('{}'),
	c2paJson: text('c2pa_json'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const searchCandidates = pgTable('search_candidates', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	stopId: text('stop_id').notNull().default(''),
	stopName: text('stop_name').notNull().default(''),
	source: text('source').notNull().default('wikimedia'),
	sourcePageUrl: text('source_page_url').notNull(),
	imageUrl: text('image_url').notNull(),
	thumbnailUrl: text('thumbnail_url').default(''),
	title: text('title').default(''),
	description: text('description').default(''),
	author: text('author').default(''),
	license: text('license').default(''),
	licenseUrl: text('license_url').default(''),
	licenseTier: text('license_tier').default('green'),        // green|yellow|red
	originalDate: text('original_date').default(''),
	dimensions: text('dimensions').default('{}'),              // JSON {width, height}
	categories: text('categories').default('[]'),              // JSON array
	searchQuery: text('search_query').default(''),
	status: text('status').notNull().default('pending'),       // pending|approved|rejected|flagged
	rejectionReason: text('rejection_reason').default(''),
	archivalAssetId: integer('archival_asset_id').references(() => archivalAssets.id, { onDelete: 'set null' }),
	rawMetadata: text('raw_metadata').default('{}'),
	// Queue fields — apply when status='processing' or 'failed'
	retryCount: integer('retry_count').default(0),
	nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
	lastError: text('last_error').default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});
