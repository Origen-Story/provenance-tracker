import { pgTable, serial, text, integer, real, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
	// C2PA signing material. Local filesystem paths to a PEM cert chain and the
	// matching private key. A self-signed dev chain is fine (npm run cert:generate);
	// production uses a CA-issued cert. Absence disables signing for the project.
	certificatePath: text('certificate_path').default(''),
	privateKeyPath: text('private_key_path').default(''),
	// CAWG identity assertion: a JSON document (typically at a well-known URL on
	// the creator's domain) describing who signed the asset.
	cawgIdentityUrl: text('cawg_identity_url').default(''),
	cawgIdentityName: text('cawg_identity_name').default(''),
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
	// Tracked in place (D12): filePath is the file where it already lived, not a
	// copy in managed storage. The tracker never moves, renames or deletes it.
	inPlace: boolean('in_place').default(false),
	// The name the public viewer shows for this asset, and that the signed
	// creator statement carries (statement v2). Empty means the file name.
	publicTitle: text('public_title').default(''),
	fileHash: text('file_hash').default(''),
	fileSize: integer('file_size').default(0),
	mimeType: text('mime_type').default(''),
	assetType: text('asset_type').default('other'),
	platform: text('platform').default('unknown'),
	digitalSourceType: text('digital_source_type').default(''),
	completeness: integer('completeness').default(0),
	// How many of the detected parser's core fields got populated (0–100).
	// `null` means extraction hasn't run (older rows pre-migration); 0 means
	// platform='unknown' or no core fields survived. Drives novelty detection.
	extractionCoverage: integer('extraction_coverage'),
	generationDate: text('generation_date').default(''),
	notes: text('notes').default(''),
	// Preserved path to the unsigned original after C2PA signing moves filePath
	// to the signed copy. Keeps the untouched source discoverable for re-signing.
	originalFilePath: text('original_file_path'),
	// Origin class (decision D3): proposed by src/server/lib/origin/classify.js,
	// confirmed by the user. `originClassSource` names the rule that fired.
	// `originIngredientClasses` is a JSON array of classes a composited asset
	// is made from.
	originClass: text('origin_class').default('unknown'),
	originClassConfirmed: boolean('origin_class_confirmed').default(false),
	originClassSource: text('origin_class_source').default(''),
	originIngredientClasses: text('origin_ingredient_classes').default('[]'),
	// Free-text reason the user gave when setting the class by hand (why a
	// signed or proposed class was overridden). Carried into the output manifest.
	originClassNote: text('origin_class_note').default(''),
	// Attributes beside the class (decision D11). aiAssisted: an AI model wrote
	// the instructions and an ordinary program made the pixels. signedBy: who
	// vouches for the file's credentials ('' | device | tool | creator), with the
	// signer's name as the certificate gives it.
	aiAssisted: boolean('ai_assisted').default(false),
	signedBy: text('signed_by').default(''),
	signerName: text('signer_name').default(''),
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

// Links between any two assets across the three asset tables (decision D4):
// each side is a (type, id) pair where type is 'ai' | 'archival' | 'produced'.
// No foreign keys, because the id points at one of three tables; the delete
// functions in each lib module remove the rows that reference them.
// relationshipType: 'ingredient' (child is made from parent), 'derived_from'
// (child is an enhanced/upscaled copy of parent), 'output_of' (child is an
// NLE export that used parent).
export const assetRelationships = pgTable('asset_relationships', {
	id: serial('id').primaryKey(),
	parentAssetType: text('parent_asset_type').notNull().default('ai'),
	parentAssetId: integer('parent_asset_id').notNull(),
	childAssetType: text('child_asset_type').notNull().default('ai'),
	childAssetId: integer('child_asset_id').notNull(),
	relationshipType: text('relationship_type').notNull().default('ingredient'),
	// How the link was made: 'manual', 'filename_pattern', 'c2pa_ingredient', 'timeline'.
	matchMethod: text('match_method').notNull().default('manual'),
	confidence: real('confidence').default(1),
	notes: text('notes').default(''),
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
	// Tracked in place (D12): filePath is the file where it already lived, not a
	// copy in managed storage. The tracker never moves, renames or deletes it.
	inPlace: boolean('in_place').default(false),
	// The name the public viewer shows for this asset, and that the signed
	// creator statement carries (statement v2). Empty means the file name.
	publicTitle: text('public_title').default(''),
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
	// Origin class (decision D3); see the assets table for the field notes.
	originClass: text('origin_class').default('unknown'),
	originClassConfirmed: boolean('origin_class_confirmed').default(false),
	originClassSource: text('origin_class_source').default(''),
	originIngredientClasses: text('origin_ingredient_classes').default('[]'),
	// Free-text reason the user gave when setting the class by hand (why a
	// signed or proposed class was overridden). Carried into the output manifest.
	originClassNote: text('origin_class_note').default(''),
	// Attributes beside the class (decision D11). aiAssisted: an AI model wrote
	// the instructions and an ordinary program made the pixels. signedBy: who
	// vouches for the file's credentials ('' | device | tool | creator), with the
	// signer's name as the certificate gives it.
	aiAssisted: boolean('ai_assisted').default(false),
	signedBy: text('signed_by').default(''),
	signerName: text('signer_name').default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const producedAssets = pgTable('produced_assets', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	name: text('name').notNull().default(''),
	filename: text('filename').notNull().default(''),
	filePath: text('file_path').notNull(),
	// Tracked in place (D12): filePath is the file where it already lived, not a
	// copy in managed storage. The tracker never moves, renames or deletes it.
	inPlace: boolean('in_place').default(false),
	// The name the public viewer shows for this asset, and that the signed
	// creator statement carries (statement v2). Empty means the file name.
	publicTitle: text('public_title').default(''),
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
	// Media duration in seconds (fractional). Filled by extraction for audio and
	// video; null for images and for rows imported before extraction read it.
	durationSeconds: real('duration_seconds'),
	// Technical video fields from exiftool (src/server/lib/extraction/video-probe.js).
	frameRate: real('frame_rate'),
	width: integer('width').default(0),
	height: integer('height').default(0),
	container: text('container').default(''),
	videoCodec: text('video_codec').default(''),
	audioCodec: text('audio_codec').default(''),
	// True when the file carries a C2PA capture manifest from the device.
	captureSigned: boolean('capture_signed').default(false),
	// Preserved path to the unsigned original after C2PA signing.
	originalFilePath: text('original_file_path'),
	// A finished edit (decision D10) rather than a source recording. Set when a
	// timeline is imported, when the file's credentials list ingredients, or by
	// the user; outputSource names which.
	isOutput: boolean('is_output').default(false),
	outputSource: text('output_source').default(''),
	// Origin class (decision D3); see the assets table for the field notes.
	originClass: text('origin_class').default('unknown'),
	originClassConfirmed: boolean('origin_class_confirmed').default(false),
	originClassSource: text('origin_class_source').default(''),
	originIngredientClasses: text('origin_ingredient_classes').default('[]'),
	// Free-text reason the user gave when setting the class by hand (why a
	// signed or proposed class was overridden). Carried into the output manifest.
	originClassNote: text('origin_class_note').default(''),
	// Attributes beside the class (decision D11). aiAssisted: an AI model wrote
	// the instructions and an ordinary program made the pixels. signedBy: who
	// vouches for the file's credentials ('' | device | tool | creator), with the
	// signer's name as the certificate gives it.
	aiAssisted: boolean('ai_assisted').default(false),
	signedBy: text('signed_by').default(''),
	signerName: text('signer_name').default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// One imported NLE timeline (xmeml today) for a produced output. The raw
// file is kept on disk at sourceFilePath; breakdownJson caches the computed
// screen-time breakdown and is recomputed when a segment's match or an
// asset's origin class changes.
export const timelines = pgTable('timelines', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	producedAssetId: integer('produced_asset_id').references(() => producedAssets.id, { onDelete: 'cascade' }),
	sourceFormat: text('source_format').notNull().default('xmeml'),
	sourceFormatVersion: text('source_format_version').default(''),
	sourceFileName: text('source_file_name').default(''),
	sourceFilePath: text('source_file_path').default(''),
	sourceFileHash: text('source_file_hash').default(''),
	sequenceName: text('sequence_name').default(''),
	timebase: integer('timebase').default(0),
	ntsc: boolean('ntsc').default(false),
	fps: real('fps'),
	durationFrames: integer('duration_frames').default(0),
	width: integer('width').default(0),
	height: integer('height').default(0),
	primaryTrackIndex: integer('primary_track_index').default(1),
	includeOverlays: boolean('include_overlays').default(false),
	breakdownJson: text('breakdown_json').default('{}'),
	notesJson: text('notes_json').default('[]'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// One row per clip on a track. matchedAssetType/Id point at one of the three
// asset tables (D4 style, no FK); originClass is a per-segment override and
// null means "use the matched asset's class".
export const timelineSegments = pgTable('timeline_segments', {
	id: serial('id').primaryKey(),
	timelineId: integer('timeline_id').notNull().references(() => timelines.id, { onDelete: 'cascade' }),
	trackKind: text('track_kind').notNull().default('video'),
	trackIndex: integer('track_index').notNull().default(1),
	clipId: text('clip_id').default(''),
	clipName: text('clip_name').default(''),
	enabled: boolean('enabled').default(true),
	startFrame: integer('start_frame').notNull().default(0),
	endFrame: integer('end_frame').notNull().default(0),
	inFrame: integer('in_frame').default(0),
	outFrame: integer('out_frame').default(0),
	startSeconds: real('start_seconds'),
	endSeconds: real('end_seconds'),
	sourceKind: text('source_kind').default('file'),
	sourceKey: text('source_key').default(''),
	sourceName: text('source_name').default(''),
	sourcePath: text('source_path').default(''),
	matchedAssetType: text('matched_asset_type'),
	matchedAssetId: integer('matched_asset_id'),
	matchMethod: text('match_method').default('unmatched'),
	matchConfidence: real('match_confidence').default(0),
	originClass: text('origin_class'),
	sortOrder: integer('sort_order').default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

// The creator's statement for a finished edit (phase 4c): the words and who
// says them. The numbers are not stored here; they are built from the
// timeline when the statement is shown or signed, and the signed version is
// frozen in signatures.statement_json.
export const creatorStatements = pgTable('creator_statements', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	producedAssetId: integer('produced_asset_id').notNull().references(() => producedAssets.id, { onDelete: 'cascade' }),
	text: text('text').notNull().default(''),
	authorName: text('author_name').default(''),
	organization: text('organization').default(''),
	// What the edit was made in (Premiere, Resolve). xmeml does not say reliably.
	softwareAgent: text('software_agent').default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
}, (t) => [uniqueIndex('creator_statements_produced_asset_idx').on(t.producedAssetId)]);

// One signed copy of an asset or an output. The asset row keeps pointing at
// the original (CLAUDE.md: originals are never modified, the row keeps the
// original path); this row records the new file, what was signed into it and
// how it read back. assetType/assetId follow D4 (no FK across the three tables).
export const signatures = pgTable('signatures', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	assetType: text('asset_type').notNull(),
	assetId: integer('asset_id').notNull(),
	kind: text('kind').notNull().default('asset'),              // 'asset' | 'output'
	version: integer('version').notNull().default(1),
	sourcePath: text('source_path').notNull(),
	sourceHash: text('source_hash').default(''),
	signedPath: text('signed_path').notNull(),
	signedHash: text('signed_hash').default(''),
	signedSize: integer('signed_size').default(0),
	// The manifest definition without key paths, and c2patool's read-back.
	definitionJson: text('definition_json').default('{}'),
	reportJson: text('report_json'),
	statementJson: text('statement_json'),
	status: text('status').default(''),
	signerName: text('signer_name').default(''),
	signerIssuer: text('signer_issuer').default(''),
	timestamped: boolean('timestamped').default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const searchJobs = pgTable('search_jobs', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	groupId: text('group_id').notNull().default(''),             // denormalized so deleting the group doesn't orphan
	groupName: text('group_name').notNull().default(''),
	status: text('status').notNull().default('queued'),          // queued | running | completed | failed | cancelled
	keywordsTotal: integer('keywords_total').default(0),
	keywordsDone: integer('keywords_done').default(0),
	categoriesTotal: integer('categories_total').default(0),
	categoriesDone: integer('categories_done').default(0),
	uniqueTitles: integer('unique_titles').default(0),
	titlesFetched: integer('titles_fetched').default(0),    // image-info batches completed (each batch = 50 titles)
	candidatesInserted: integer('candidates_inserted').default(0),
	skippedLicense: integer('skipped_license').default(0),
	skippedDuplicate: integer('skipped_duplicate').default(0),
	skippedExisting: integer('skipped_existing').default(0),
	leaseUntil: timestamp('lease_until', { withTimezone: true }),
	lastError: text('last_error').default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	startedAt: timestamp('started_at', { withTimezone: true }),
	completedAt: timestamp('completed_at', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const searchGroups = pgTable('search_groups', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	groupId: text('group_id').notNull().default(''),           // stable identifier, user-editable, unique per project
	groupName: text('group_name').notNull().default(''),       // display name
	keywords: text('keywords').default('{}'),                  // JSON dict { lang: [terms] } — lang keys free-form
	categories: text('categories').default('[]'),              // JSON array of Wikimedia category names
	notes: text('notes').default(''),
	sortOrder: integer('sort_order').default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
}, (table) => ({
	projectGroupIdx: uniqueIndex('search_groups_project_group_idx').on(table.projectId, table.groupId)
}));

export const searchCandidates = pgTable('search_candidates', {
	id: serial('id').primaryKey(),
	projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	searchGroupId: text('search_group_id').notNull().default(''),
	searchGroupName: text('search_group_name').notNull().default(''),
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
