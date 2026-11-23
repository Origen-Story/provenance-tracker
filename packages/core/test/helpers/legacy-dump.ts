// Made-up Postgres dump text, in the shape pg_restore --data-only writes,
// for the migration tests. Every table and column the migration knows is
// written; a test gives only the values it cares about, the rest are the
// app's defaults (or null).

import { LEGACY_TABLES } from "../../src/legacy/tables.ts";

export type DumpRow = Record<string, string | number | boolean | null>;

/** The app's column defaults, where a null would not be what the app wrote. */
const DEFAULTS: Record<string, DumpRow> = {
	"public.projects": {
		description: "",
		asset_id_prefix: "PROJ",
		modules: '["archival"]',
		storage_path: "",
		notion_enabled: false,
		notion_archival_db_id: "",
		notion_group_property: "",
		certificate_path: "",
		private_key_path: "",
		cawg_identity_url: "",
		cawg_identity_name: "",
		is_active: false,
		created_at: "2026-10-01 10:00:00.123456+02",
		updated_at: "2026-10-02 11:00:00.5+02",
	},
	asset: {
		description: "",
		in_place: true,
		public_title: "",
		file_hash: "",
		file_size: 0,
		mime_type: "",
		origin_class: "unknown",
		origin_class_confirmed: false,
		origin_class_source: "",
		origin_ingredient_classes: "[]",
		origin_class_note: "",
		ai_assisted: false,
		signed_by: "",
		signer_name: "",
		created_at: "2026-11-01 09:00:00.000001+01",
		updated_at: "2026-11-02 09:00:00.999999+01",
	},
	"public.assets": {
		asset_type: "image",
		platform: "unknown",
		digital_source_type: "",
		completeness: 0,
		generation_date: "",
		notes: "",
	},
	"public.archival_assets": {
		name: "",
		filename: "",
		source_url: "",
		image_url: "",
		access_date: "",
		creator: "",
		institution: "",
		license: "",
		license_url: "",
		caption: "",
		original_date: "",
		medium: "photograph",
		usage_notes: "",
		exif_json: "{}",
		notion_page_id: "",
		notion_image_strategy: "external_url",
		search_group_id: "",
		search_group_name: "",
	},
	"public.produced_assets": {
		name: "",
		filename: "",
		asset_type: "audio",
		creator: "",
		recording_date: "",
		location: "",
		equipment: "",
		usage_notes: "",
		exif_json: "{}",
		width: 0,
		height: 0,
		container: "",
		video_codec: "",
		audio_codec: "",
		capture_signed: false,
		is_output: false,
		output_source: "",
	},
	"public.generation_params": {
		prompt: "",
		negative_prompt: "",
		model_name: "",
		model_version: "",
		seed: "",
		steps: 0,
		cfg_scale: "",
		sampler: "",
		scheduler: "",
		width: 0,
		height: 0,
		aspect_ratio: "",
		stylize: "",
		style_raw: "",
		loras: "[]",
		controlnets: "[]",
		other_params: "{}",
		created_at: "2026-11-01 09:00:01+01",
	},
	"public.asset_relationships": {
		match_method: "manual",
		confidence: 1,
		notes: "",
		created_at: "2026-11-03 12:00:00+01",
	},
	"public.timelines": {
		source_format: "xmeml",
		source_format_version: "5",
		source_file_name: "cut.xml",
		sequence_name: "Cut",
		timebase: 25,
		ntsc: false,
		fps: 25,
		duration_frames: 250,
		width: 1920,
		height: 1080,
		primary_track_index: 1,
		include_overlays: false,
		breakdown_json: "{}",
		notes_json: "[]",
		created_at: "2026-11-04 10:00:00+01",
		updated_at: "2026-11-04 10:05:00+01",
	},
	"public.timeline_segments": {
		track_kind: "video",
		track_index: 1,
		clip_id: "",
		clip_name: "",
		enabled: true,
		in_frame: 0,
		out_frame: 0,
		source_kind: "file",
		source_name: "",
		source_path: "",
		match_method: "unmatched",
		match_confidence: 0,
		sort_order: 0,
		created_at: "2026-11-04 10:00:00+01",
	},
	"public.creator_statements": {
		text: "",
		author_name: "",
		organization: "",
		software_agent: "",
		created_at: "2026-11-05 10:00:00+01",
		updated_at: "2026-11-05 10:10:00+01",
	},
	"public.signatures": {
		kind: "asset",
		version: 1,
		source_hash: "",
		signed_hash: "",
		signed_size: 0,
		definition_json: "{}",
		status: "",
		signer_name: "",
		signer_issuer: "",
		timestamped: false,
		created_at: "2026-11-06 10:00:00+01",
	},
};

const ASSET_TABLES = [
	"public.assets",
	"public.archival_assets",
	"public.produced_assets",
];

/** A value as COPY text writes it. */
export function copyField(
	value: string | number | boolean | null | undefined,
): string {
	if (value === null || value === undefined) return "\\N";
	if (typeof value === "boolean") return value ? "t" : "f";
	return String(value)
		.replaceAll("\\", "\\\\")
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r")
		.replaceAll("\t", "\\t");
}

/**
 * Dump text for the given rows. Every known table is written, empty if not
 * given; each row gets its table's defaults under what the test gave.
 */
export function dumpText(
	rows: Record<string, DumpRow[]>,
	opts: {
		omitColumn?: [string, string];
		extraColumn?: [string, string];
		extraTable?: string;
	} = {},
): string {
	const out = [
		"--",
		"-- PostgreSQL database dump",
		"--",
		"SET client_encoding = 'UTF8';",
		"",
	];
	const tables = [...Object.keys(LEGACY_TABLES)];
	if (opts.extraTable) tables.push(opts.extraTable);
	for (const table of tables) {
		let columns = Object.keys(LEGACY_TABLES[table]?.columns ?? { id: null });
		if (opts.omitColumn?.[0] === table)
			columns = columns.filter((c) => c !== opts.omitColumn![1]);
		if (opts.extraColumn?.[0] === table) columns.push(opts.extraColumn[1]);
		const defaults = {
			...(ASSET_TABLES.includes(table) ? DEFAULTS.asset : {}),
			...DEFAULTS[table],
		};
		out.push(`COPY ${table} (${columns.join(", ")}) FROM stdin;`);
		for (const row of rows[table] ?? []) {
			const full = { ...defaults, ...row };
			out.push(columns.map((c) => copyField(full[c])).join("\t"));
		}
		out.push("\\.", "");
	}
	return out.join("\n");
}
