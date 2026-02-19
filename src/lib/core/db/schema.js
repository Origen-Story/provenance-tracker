import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projectConfig = sqliteTable('project_config', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	projectName: text('project_name').notNull().default('Untitled Project'),
	author: text('author').default(''),
	organization: text('organization').default(''),
	certificatePath: text('certificate_path').default(''),
	privateKeyPath: text('private_key_path').default(''),
	storageRootPath: text('storage_root_path').default(''),
	assetIdPrefix: text('asset_id_prefix').default('GAIA'),
	defaultDigitalSourceType: text('default_digital_source_type')
		.default('http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'),
	createdAt: text('created_at').default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').default(sql`(datetime('now'))`)
});

export const assets = sqliteTable('assets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
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
	createdAt: text('created_at').default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').default(sql`(datetime('now'))`)
});

export const assetMetadata = sqliteTable('asset_metadata', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	assetId: integer('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
	metadataType: text('metadata_type').notNull(),
	rawJson: text('raw_json').notNull().default('{}'),
	extractedAt: text('extracted_at').default(sql`(datetime('now'))`)
});

export const generationParams = sqliteTable('generation_params', {
	id: integer('id').primaryKey({ autoIncrement: true }),
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
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const assetRelationships = sqliteTable('asset_relationships', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	parentAssetId: integer('parent_asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
	childAssetId: integer('child_asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
	relationshipType: text('relationship_type').notNull().default('ingredient'),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const manifests = sqliteTable('manifests', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	assetId: integer('asset_id').references(() => assets.id, { onDelete: 'set null' }),
	manifestJson: text('manifest_json').notNull().default('{}'),
	manifestType: text('manifest_type').notNull().default('individual'),
	signedAt: text('signed_at').default(''),
	outputPath: text('output_path').default(''),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});
