// Every table and column of the app's Postgres database (src/server/db/schema.js),
// and what the migration does with each (roadmap Phase 5). A dump with a
// table or column not listed here is refused, so nothing can be dropped
// without someone first deciding what it is.
//
//   carried      the value lands in the catalog
//   checked      the value is compared with the file or the catalog, and a
//                difference is reported (a file's hash, its size)
//   not-carried  the catalog has no place for it, on purpose; every value
//                other than an empty one is listed in the report, with why
//   implied      the catalog keeps the same fact another way (a clip's
//                creation is its timeline's import); counted, not listed

import type { CopyRow, CopyTable } from "./copy-text.ts";

export type ColumnUse = "carried" | "checked" | "not-carried" | "implied";

export interface ColumnRule {
	use: ColumnUse;
	/** Where it goes, or why it does not. */
	note: string;
	/** Values that count as empty for the report (null always does). */
	empty?: readonly string[];
	/** Report only that a value is present, never the value (a key path). */
	hidden?: boolean;
}

export interface TableRule {
	/** Why the table is carried or not, for the report. */
	note: string;
	columns: Record<string, ColumnRule>;
}

const carried = (note: string): ColumnRule => ({ use: "carried", note });
const checked = (note: string): ColumnRule => ({ use: "checked", note });
const implied = (note: string): ColumnRule => ({ use: "implied", note });
const notCarried = (
	note: string,
	empty: readonly string[] = [],
	hidden = false,
): ColumnRule => ({ use: "not-carried", note, empty: ["", ...empty], hidden });

const NOTION = "Notion sync is parked (roadmap); the catalog does not keep it";
const KEY_PATH = "the catalog never holds certificate or key paths";
const SEARCH =
	"the archival search queue is parked; nothing is carried from it";
const IN_PLACE =
	"every file in the catalog is tracked where it is; the flag has no meaning there";
const DERIVED_FROM_FILE = "read fresh from the file by extract";
const TECHNICAL =
	"read fresh from the file by extract (technical view); the dry run compares the two";
const TIMES = (what: string) => carried(`${what}; to the millisecond`);

const ORIGIN_COLUMNS: Record<string, ColumnRule> = {
	origin_class: carried("assets.origin_class"),
	origin_class_confirmed: carried("assets.origin_class_confirmed"),
	origin_class_source: carried("assets.origin_class_source"),
	origin_ingredient_classes: carried("assets.origin_ingredient_classes"),
	origin_class_note: carried("assets.origin_class_note"),
	ai_assisted: carried("assets.ai_assisted"),
	signed_by: carried("assets.signed_by"),
	signer_name: carried("assets.signer_name"),
};

const FILE_COLUMNS: Record<string, ColumnRule> = {
	file_path: carried("the file is hashed and recorded as a root and a path"),
	in_place: implied(IN_PLACE),
	file_hash: checked("compared with the file's SHA-256 on disk"),
	file_size: checked("compared with the file's size on disk"),
	mime_type: notCarried(DERIVED_FROM_FILE),
	public_title: carried("assets.public_title"),
};

const ORIGINAL_FILE_PATH = notCarried(
	"the app's signed-copy path swap, never used; a value is reported",
);

export const LEGACY_TABLES: Readonly<Record<string, TableRule>> = {
	"public.projects": {
		note: "one catalog per project",
		columns: {
			id: carried("chooses the project"),
			name: carried("meta name"),
			description: carried("meta description"),
			asset_id_prefix: carried("meta code_prefix"),
			modules: notCarried(
				"every catalog takes every kind of asset; there are no modules",
				[
					'["archival"]',
					'["archival","ai_assets"]',
					'["ai_assets","archival"]',
				],
			),
			storage_path: notCarried(
				"the catalog has roots instead of a storage folder",
			),
			notion_enabled: notCarried(NOTION, ["f"]),
			notion_archival_db_id: notCarried(NOTION),
			notion_group_property: notCarried(NOTION),
			certificate_path: notCarried(KEY_PATH, [], true),
			private_key_path: notCarried(KEY_PATH, [], true),
			cawg_identity_url: carried("meta cawg_identity_url"),
			cawg_identity_name: carried("meta cawg_identity_name"),
			is_active: notCarried("which project the app had open", ["t", "f"]),
			created_at: TIMES("meta migrated_from"),
			updated_at: TIMES("meta migrated_from"),
		},
	},
	"public.project_config": {
		note: "the app's settings before projects existed; the app never filled it",
		columns: {
			id: notCarried("a row is reported"),
			project_name: notCarried("a row is reported", ["Untitled Project"]),
			author: notCarried("a row is reported"),
			organization: notCarried("a row is reported"),
			certificate_path: notCarried(KEY_PATH, [], true),
			private_key_path: notCarried(KEY_PATH, [], true),
			storage_root_path: notCarried("a row is reported"),
			asset_id_prefix: notCarried("a row is reported", ["PROJ"]),
			default_digital_source_type: notCarried("a row is reported", [
				"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
			]),
			created_at: notCarried("a row is reported"),
			updated_at: notCarried("a row is reported"),
		},
	},
	"public.assets": {
		note: "AI-generated assets: kind generated",
		columns: {
			id: carried("history evidence (legacy table and id)"),
			project_id: carried("chooses the project"),
			asset_id: carried("assets.code"),
			description: carried("assets.description"),
			...FILE_COLUMNS,
			asset_type: notCarried(DERIVED_FROM_FILE, [
				"image",
				"video",
				"audio",
				"other",
			]),
			original_file_path: ORIGINAL_FILE_PATH,
			platform: carried("generation.platform"),
			digital_source_type: checked(
				"the same as origin_class, or empty; a different value is reported",
			),
			completeness: notCarried(
				"a score the app worked out; extract works out its own",
				["0"],
			),
			extraction_coverage: notCarried(
				"a score the app worked out; extract works out its own",
				["0"],
			),
			generation_date: carried("generation.generated_at"),
			notes: carried("assets.notes"),
			...ORIGIN_COLUMNS,
			created_at: TIMES("assets.created_at"),
			updated_at: TIMES("the time of the asset's history entries"),
		},
	},
	"public.asset_metadata": {
		note: "what the app read from AI assets: legacy observations",
		columns: {
			id: carried("observation evidence"),
			asset_id: carried("the asset's content"),
			metadata_type: carried("observations.kind, as legacy-<type>"),
			raw_json: carried("observations.data"),
			extracted_at: TIMES("observations.observed_at"),
		},
	},
	"public.generation_params": {
		note: "how an AI asset was made: generation",
		columns: {
			id: carried("history evidence"),
			asset_id: carried("generation.asset_id"),
			prompt: carried("generation.prompt"),
			negative_prompt: carried("generation.negative_prompt"),
			model_name: carried("generation.model_name"),
			model_version: carried("generation.model_version"),
			seed: carried("generation.seed"),
			steps: carried("generation.steps; 0 (the app's unknown) is empty"),
			cfg_scale: carried("generation.cfg_scale"),
			sampler: carried("generation.sampler"),
			scheduler: carried("generation.scheduler"),
			width: carried("generation.width; 0 (the app's unknown) is empty"),
			height: carried("generation.height; 0 (the app's unknown) is empty"),
			aspect_ratio: carried("generation.aspect_ratio"),
			stylize: carried("generation.stylize"),
			style_raw: carried("generation.style_raw"),
			loras: carried("generation.loras"),
			controlnets: carried("generation.controlnets"),
			other_params: carried("generation.other"),
			created_at: TIMES("the time of the generation's history entries"),
		},
	},
	"public.asset_relationships": {
		note: "links between assets: relationships",
		columns: {
			id: carried("history evidence"),
			parent_asset_type: carried("relationships.parent_id"),
			parent_asset_id: carried("relationships.parent_id"),
			child_asset_type: carried("relationships.child_id"),
			child_asset_id: carried("relationships.child_id"),
			relationship_type: carried("relationships.type"),
			match_method: carried("relationships.match_method"),
			confidence: carried("relationships.confidence"),
			notes: carried("relationships.note"),
			created_at: TIMES("relationships.created_at"),
		},
	},
	"public.manifests": {
		note: "the app never wrote one; signatures hold every signing",
		columns: {
			id: notCarried("a row is reported"),
			asset_id: notCarried("a row is reported"),
			manifest_json: notCarried("a row is reported", ["{}"]),
			manifest_type: notCarried("a row is reported", ["individual"]),
			signed_at: notCarried("a row is reported"),
			output_path: notCarried("a row is reported"),
			created_at: notCarried("a row is reported"),
		},
	},
	"public.archival_assets": {
		note: "archival assets: kind archival",
		columns: {
			id: carried("history evidence (legacy table and id)"),
			project_id: carried("chooses the project"),
			name: carried("assets.title"),
			filename: checked(
				"the same as the file's name; a different value is reported",
			),
			...FILE_COLUMNS,
			source_url: carried("assets.source_url"),
			image_url: notCarried(
				"the catalog has no image URL beside source_url; a value is reported to keep by hand",
			),
			access_date: carried("assets.access_date"),
			creator: carried("a credit, role creator, stated by the legacy import"),
			institution: carried(
				"a credit, role institution, stated by the legacy import",
			),
			license: carried("assets.license"),
			license_url: carried("assets.license_url"),
			caption: carried("assets.caption"),
			original_date: carried("assets.original_date"),
			medium: carried("assets.medium"),
			usage_notes: carried("assets.usage_notes"),
			exif_json: carried("an observation, kind legacy-exif"),
			c2pa_json: carried("an observation, kind legacy-c2pa"),
			notion_page_id: notCarried(NOTION),
			notion_synced_at: notCarried(NOTION),
			notion_image_strategy: notCarried(NOTION, ["external_url"]),
			search_group_id: notCarried(SEARCH),
			search_group_name: notCarried(SEARCH),
			...ORIGIN_COLUMNS,
			created_at: TIMES("assets.created_at"),
			updated_at: TIMES("the time of the asset's history entries"),
		},
	},
	"public.produced_assets": {
		note: "recordings, renders and edits: kind produced",
		columns: {
			id: carried("history evidence (legacy table and id)"),
			project_id: carried("chooses the project"),
			name: carried("assets.title"),
			filename: checked(
				"the same as the file's name; a different value is reported",
			),
			...FILE_COLUMNS,
			asset_type: notCarried(DERIVED_FROM_FILE, [
				"image",
				"video",
				"audio",
				"document",
				"other",
			]),
			description: carried("assets.description"),
			creator: carried("a credit, role creator, stated by the legacy import"),
			recording_date: carried("assets.recorded_date"),
			location: carried("assets.recorded_location"),
			equipment: carried("assets.equipment"),
			usage_notes: carried("assets.usage_notes"),
			exif_json: carried("an observation, kind legacy-exif"),
			c2pa_json: carried("an observation, kind legacy-c2pa"),
			duration_seconds: notCarried(TECHNICAL),
			frame_rate: notCarried(TECHNICAL),
			width: notCarried(TECHNICAL, ["0"]),
			height: notCarried(TECHNICAL, ["0"]),
			container: notCarried(TECHNICAL),
			video_codec: notCarried(TECHNICAL),
			audio_codec: notCarried(TECHNICAL),
			capture_signed: notCarried(
				"read fresh from the file's credentials by extract",
				["t", "f"],
			),
			original_file_path: ORIGINAL_FILE_PATH,
			is_output: carried("assets.is_output"),
			output_source: carried("assets.output_source"),
			...ORIGIN_COLUMNS,
			created_at: TIMES("assets.created_at"),
			updated_at: TIMES("the time of the asset's history entries"),
		},
	},
	"public.timelines": {
		note: "imported timelines: timelines, with the file kept in .provenancetracker/timelines",
		columns: {
			id: carried("history evidence"),
			project_id: carried("chooses the project"),
			produced_asset_id: carried(
				"timelines.content_sha256 (the output's file)",
			),
			source_format: carried("timelines.format"),
			source_format_version: carried("timelines.format_version"),
			source_file_name: carried("timelines.file_name"),
			source_file_path: carried(
				"the file is copied to .provenancetracker/timelines/<sha256>",
			),
			source_file_hash: carried(
				"timelines.file_sha256, checked against the file",
			),
			sequence_name: carried("timelines.sequence_name"),
			timebase: carried("timelines.timebase"),
			ntsc: carried("timelines.ntsc"),
			fps: carried("timelines.fps"),
			duration_frames: carried("timelines.duration_frames"),
			width: carried("timelines.width"),
			height: carried("timelines.height"),
			primary_track_index: carried("timelines.primary_track_index"),
			include_overlays: carried("timelines.include_overlays"),
			breakdown_json: carried(
				"timelines.breakdown; the dry run recomputes it and compares",
			),
			notes_json: carried("timelines.notes"),
			created_at: TIMES("timelines.imported_at"),
			updated_at: TIMES("the time of the timeline's history entries"),
		},
	},
	"public.timeline_segments": {
		note: "clips: one timeline_sources row per source, one timeline_clips row per clip",
		columns: {
			id: carried("history evidence"),
			timeline_id: carried("timeline_clips.timeline_id"),
			track_kind: carried("timeline_clips.track_kind"),
			track_index: carried("timeline_clips.track_index"),
			clip_id: carried("timeline_clips.clip_key"),
			clip_name: carried("timeline_clips.name"),
			enabled: carried("timeline_clips.enabled"),
			start_frame: carried("timeline_clips.start_frame"),
			end_frame: carried("timeline_clips.end_frame"),
			in_frame: carried("timeline_clips.in_frame"),
			out_frame: carried("timeline_clips.out_frame"),
			start_seconds: carried("timeline_clips.start_seconds"),
			end_seconds: carried("timeline_clips.end_seconds"),
			source_kind: carried("timeline_sources.kind"),
			source_key: carried("timeline_sources.source_key"),
			source_name: carried("timeline_sources.name"),
			source_path: carried("timeline_sources.path"),
			matched_asset_type: carried("timeline_sources.asset_id"),
			matched_asset_id: carried("timeline_sources.asset_id"),
			match_method: carried("timeline_sources.match_method"),
			match_confidence: carried("timeline_sources.match_confidence"),
			origin_class: carried("timeline_clips.origin_class"),
			sort_order: carried("timeline_clips.sort_order"),
			created_at: implied(
				"a clip is created with its timeline; the timeline's import time is kept",
			),
		},
	},
	"public.creator_statements": {
		note: "creator statements: one saved statement each",
		columns: {
			id: carried("history evidence"),
			project_id: carried("chooses the project"),
			produced_asset_id: carried("statements.asset_id"),
			text: carried("statements.text"),
			author_name: carried("statements.author"),
			organization: carried("statements.organization"),
			software_agent: carried("statements.edited_with"),
			created_at: notCarried(
				"Postgres kept one row, overwritten on each save; only the last save is known (updated_at)",
			),
			updated_at: TIMES("statements.saved_at"),
		},
	},
	"public.signatures": {
		note: "signings: signatures, with each signed copy a content of its asset",
		columns: {
			id: carried("history evidence"),
			project_id: carried("chooses the project"),
			asset_type: carried("signatures.asset_id"),
			asset_id: carried("signatures.asset_id"),
			kind: carried("signatures.kind"),
			version: carried("signatures.version"),
			source_path: checked(
				"the file signed; hashed and compared with source_hash",
			),
			source_hash: carried("signatures.source_sha256"),
			signed_path: carried(
				"the signed copy is hashed and recorded as a content of the asset",
			),
			signed_hash: carried(
				"signatures.signed_sha256, checked against the file",
			),
			signed_size: checked("compared with the signed copy's size on disk"),
			definition_json: carried("signatures.definition"),
			report_json: carried("signatures.report"),
			statement_json: carried("signatures.statement"),
			status: carried("signatures.status"),
			signer_name: carried("signatures.signer_name"),
			signer_issuer: carried("signatures.signer_issuer"),
			timestamped: carried("signatures.timestamped"),
			created_at: TIMES("signatures.signed_at"),
		},
	},
	"public.search_jobs": {
		note: SEARCH,
		columns: Object.fromEntries(
			[
				"id",
				"project_id",
				"group_id",
				"group_name",
				"status",
				"keywords_total",
				"keywords_done",
				"categories_total",
				"categories_done",
				"unique_titles",
				"titles_fetched",
				"candidates_inserted",
				"skipped_license",
				"skipped_duplicate",
				"skipped_existing",
				"lease_until",
				"last_error",
				"created_at",
				"started_at",
				"completed_at",
				"updated_at",
			].map((c) => [c, notCarried("a row is reported")]),
		),
	},
	"public.search_groups": {
		note: SEARCH,
		columns: Object.fromEntries(
			[
				"id",
				"project_id",
				"group_id",
				"group_name",
				"keywords",
				"categories",
				"notes",
				"sort_order",
				"created_at",
				"updated_at",
			].map((c) => [c, notCarried("a row is reported")]),
		),
	},
	"public.search_candidates": {
		note: SEARCH,
		columns: Object.fromEntries(
			[
				"id",
				"project_id",
				"search_group_id",
				"search_group_name",
				"source",
				"source_page_url",
				"image_url",
				"thumbnail_url",
				"title",
				"description",
				"author",
				"license",
				"license_url",
				"license_tier",
				"original_date",
				"dimensions",
				"categories",
				"search_query",
				"status",
				"rejection_reason",
				"archival_asset_id",
				"raw_metadata",
				"retry_count",
				"next_attempt_at",
				"last_error",
				"created_at",
				"updated_at",
			].map((c) => [c, notCarried("a row is reported")]),
		),
	},
	"drizzle.__drizzle_migrations": {
		note: "the app's schema history; its count is kept in meta migrated_from",
		columns: {
			id: implied("counted in meta migrated_from"),
			hash: implied("counted in meta migrated_from"),
			created_at: implied("counted in meta migrated_from"),
		},
	},
};

/** Tables whose rows are not carried at all; any row in them is reported. */
export const UNCARRIED_TABLES: readonly string[] = [
	"public.project_config",
	"public.manifests",
	"public.search_jobs",
	"public.search_groups",
	"public.search_candidates",
];

/**
 * Check that the dump has exactly the tables and columns listed: refuses a
 * table or column the migration does not know, and one it expects but the
 * dump lacks.
 */
export function checkLegacyShape(tables: Map<string, CopyTable>): void {
	const problems: string[] = [];
	for (const [name, table] of tables) {
		const rule = Object.hasOwn(LEGACY_TABLES, name)
			? LEGACY_TABLES[name]
			: undefined;
		if (!rule) {
			problems.push(
				`the dump has a table the migration does not know: ${name}`,
			);
			continue;
		}
		for (const col of table.columns)
			if (!Object.hasOwn(rule.columns, col))
				problems.push(
					`${name} has a column the migration does not know: ${col}`,
				);
		for (const col of Object.keys(rule.columns))
			if (!table.columns.includes(col))
				problems.push(
					`${name} has no column ${col}, which the migration expects`,
				);
	}
	for (const name of Object.keys(LEGACY_TABLES))
		if (!tables.has(name))
			problems.push(
				`the dump has no table ${name}, which the migration expects`,
			);
	if (problems.length)
		throw new Error(
			`This dump is not the shape the migration was written for:\n- ${problems.join("\n- ")}`,
		);
}

/** A value the report should list: a not-carried column's value that is not empty. */
export interface UncarriedValue {
	table: string;
	id: string | null;
	column: string;
	/** null when the rule hides the value (a key path): only its presence is said. */
	value: string | null;
	why: string;
}

/** The not-carried values of some rows of one table. */
export function uncarriedValues(
	table: string,
	rows: readonly CopyRow[],
): UncarriedValue[] {
	const rule = LEGACY_TABLES[table];
	const out: UncarriedValue[] = [];
	for (const row of rows)
		for (const [column, r] of Object.entries(rule.columns)) {
			if (r.use !== "not-carried") continue;
			const value = row[column];
			if (value === null || value === undefined) continue;
			if (r.empty?.includes(value)) continue;
			out.push({
				table,
				id: row.id ?? null,
				column,
				value: r.hidden ? null : value,
				why: UNCARRIED_TABLES.includes(table) ? rule.note : r.note,
			});
		}
	return out;
}
