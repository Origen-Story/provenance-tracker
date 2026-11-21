// The fields a person (or a tool acting as one) may change, table by table.
//
// Every change to one of these goes through edit.ts, which writes the new
// value and a history row in one transaction. verify.ts checks the other way
// round: each listed field equals its latest history entry, or its column's
// default if it has never been changed. Anything not listed here is written
// once by the code that creates the row (a hash, a time, what a file said),
// or is derived (the *_folded columns, updated_at).

export type FieldType = "text" | "integer" | "real" | "boolean" | "json";

export interface FieldSpec {
	type: FieldType;
	/** May hold null. */
	nullable?: boolean;
	/** The column that holds this text accent-folded for filters. */
	folded?: string;
}

export interface TableSpec {
	/** The column that identifies a row (history's row_key). */
	key: string;
	fields: Record<string, FieldSpec>;
	/** Rows may be deleted (with their history); otherwise never. */
	removable?: boolean;
	/** Rows of other tables deleted with this one (ON DELETE CASCADE). */
	children?: Array<{ table: string; foreignKey: string }>;
}

const text: FieldSpec = { type: "text" };
const textOrNull: FieldSpec = { type: "text", nullable: true };
const integer: FieldSpec = { type: "integer" };
const integerOrNull: FieldSpec = { type: "integer", nullable: true };
const real: FieldSpec = { type: "real" };
const boolean: FieldSpec = { type: "boolean" };
const json: FieldSpec = { type: "json" };

export const EDITABLE: Readonly<Record<string, TableSpec>> = {
	roots: { key: "id", fields: { name: text, note: text } },
	assets: {
		key: "id",
		fields: {
			code: textOrNull,
			kind: text,
			is_output: boolean,
			output_source: text,
			title: { type: "text", folded: "title_folded" },
			public_title: { type: "text", folded: "public_title_folded" },
			description: text,
			caption: text,
			notes: text,
			usage_notes: text,
			original_date: text,
			medium: text,
			recorded_date: text,
			recorded_location: text,
			equipment: text,
			source_url: text,
			access_date: text,
			license: text,
			license_url: text,
			origin_class: text,
			origin_class_confirmed: boolean,
			origin_class_source: text,
			origin_class_note: text,
			origin_ingredient_classes: json,
			ai_assisted: boolean,
			signed_by: text,
			signer_name: text,
			removed_at: textOrNull,
		},
	},
	credits: {
		key: "id",
		removable: true,
		fields: {
			asset_id: integer,
			role: text,
			name: { type: "text", folded: "name_folded" },
			on_behalf_of: text,
			stated_by: text,
			sort_order: integer,
		},
	},
	generation: {
		key: "asset_id",
		removable: true,
		fields: {
			platform: text,
			model_name: text,
			model_version: text,
			prompt: text,
			negative_prompt: text,
			seed: text,
			steps: integerOrNull,
			cfg_scale: text,
			sampler: text,
			scheduler: text,
			width: integerOrNull,
			height: integerOrNull,
			aspect_ratio: text,
			stylize: text,
			style_raw: text,
			loras: json,
			controlnets: json,
			other: json,
			generated_at: text,
		},
	},
	contents: { key: "sha256", fields: { asset_id: integer } },
	relationships: {
		key: "id",
		removable: true,
		fields: {
			parent_id: integer,
			child_id: integer,
			type: text,
			match_method: text,
			confidence: real,
			note: text,
		},
	},
	timelines: {
		key: "id",
		removable: true,
		children: [
			{ table: "timeline_sources", foreignKey: "timeline_id" },
			{ table: "timeline_clips", foreignKey: "timeline_id" },
		],
		fields: { primary_track_index: integer, include_overlays: boolean },
	},
	timeline_sources: {
		key: "id",
		fields: {
			asset_id: integerOrNull,
			match_method: text,
			match_confidence: real,
		},
	},
	timeline_clips: { key: "id", fields: { origin_class: textOrNull } },
};

/** Project settings in meta that may be changed; the rest are written once. */
export const EDITABLE_META: readonly string[] = [
	"name",
	"description",
	"author",
	"organization",
	"code_prefix",
	"default_digital_source_type",
	"cawg_identity_url",
	"cawg_identity_name",
];

export function tableSpec(table: string): TableSpec {
	const spec = Object.hasOwn(EDITABLE, table) ? EDITABLE[table] : undefined;
	if (!spec) throw new Error(`"${table}" has no editable fields`);
	return spec;
}

/** Lower-case, accents removed: what the *_folded columns hold ("Peña" → "pena"). */
export function foldForSearch(value: string): string {
	return value
		.normalize("NFD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase();
}

/** A value as the column stores it. Throws on the wrong type. */
export function toColumn(
	spec: FieldSpec,
	field: string,
	value: unknown,
): string | number | null {
	if (value === null || value === undefined) {
		if (spec.nullable) return null;
		throw new Error(`${field} cannot be empty (null)`);
	}
	switch (spec.type) {
		case "text":
			if (typeof value !== "string")
				throw new Error(`${field} takes text, not ${typeof value}`);
			return value;
		case "integer":
			if (!Number.isSafeInteger(value))
				throw new Error(`${field} takes a whole number`);
			return value as number;
		case "real":
			if (typeof value !== "number" || !Number.isFinite(value))
				throw new Error(`${field} takes a number`);
			return value;
		case "boolean":
			if (value === true || value === 1) return 1;
			if (value === false || value === 0) return 0;
			throw new Error(`${field} takes true or false`);
		case "json": {
			const out = JSON.stringify(value);
			if (out === undefined) throw new Error(`${field} takes a JSON value`);
			return out;
		}
	}
}

/** A stored value as history records it: the JSON text of its logical value. */
export function toHistory(spec: FieldSpec, stored: unknown): string {
	if (stored === null || stored === undefined) return "null";
	switch (spec.type) {
		case "boolean":
			return JSON.stringify(Number(stored) === 1);
		case "json":
			return JSON.stringify(JSON.parse(String(stored)));
		case "integer":
		case "real":
			return JSON.stringify(Number(stored));
		default:
			return JSON.stringify(stored);
	}
}
