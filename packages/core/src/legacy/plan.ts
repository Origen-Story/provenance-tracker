// What one Postgres project becomes in a catalog (roadmap Phase 5). Pure:
// the tables come from parseCopyText, and the result names every file by
// the path Postgres has, for the caller to find, hash and place in a root.
//
// The three asset tables become one, with kind generated, archival or
// produced; each keeps its legacy table and id in the evidence of its
// history, so every catalog row can be traced back. Problems that would make
// the catalog wrong (a link to an asset that is not there, clips of one
// source that disagree) are listed as blocking; anything else worth a look
// (a file name that differs from the path's) as a note.

import type { CopyRow, CopyTable } from "./copy-text.ts";
import { pgBoolean, pgInteger, pgReal, pgTimestamp } from "./copy-text.ts";
import {
	checkLegacyShape,
	UNCARRIED_TABLES,
	uncarriedValues,
	type UncarriedValue,
} from "./tables.ts";

export type LegacyType = "ai" | "archival" | "produced";

/** Which Postgres table holds each type, as the D4 (type, id) pairs name them. */
export const LEGACY_TABLE: Readonly<Record<LegacyType, string>> = {
	ai: "public.assets",
	archival: "public.archival_assets",
	produced: "public.produced_assets",
};

const KIND: Readonly<Record<LegacyType, string>> = {
	ai: "generated",
	archival: "archival",
	produced: "produced",
};

/** "produced:33": one Postgres asset, as the plan refers to it. */
export type LegacyRef = string;

export const refOf = (type: string, id: number | string): LegacyRef =>
	`${type}:${id}`;

/** A file as Postgres names it, with what Postgres says its bytes are. */
export interface PlannedFile {
	/** The absolute path Postgres has, as written there ('/' or '\\'). */
	path: string;
	/** Lower-case SHA-256 hex, or null when Postgres had none. */
	sha256: string | null;
	size: number | null;
}

export interface Evidence {
	legacy: string;
	id: number;
	[key: string]: unknown;
}

export interface PlannedObservation {
	kind: string;
	/** JSON text, as Postgres held it. */
	data: string;
	observedAt: string;
	evidence: Evidence;
}

export interface PlannedAsset {
	ref: LegacyRef;
	evidence: Evidence;
	createdAt: string;
	/** The time of its history entries: when Postgres last changed it. */
	updatedAt: string;
	/** Editable assets fields (catalog/fields.ts), as logical values. */
	fields: Record<string, unknown>;
	file: PlannedFile;
	credits: Array<{ role: string; name: string }>;
	generation: {
		fields: Record<string, unknown>;
		at: string;
		evidence: Evidence;
	} | null;
	observations: PlannedObservation[];
}

export interface PlannedRelationship {
	parent: LegacyRef;
	child: LegacyRef;
	fields: {
		type: string;
		match_method: string;
		confidence: number;
		note: string;
	};
	createdAt: string;
	evidence: Evidence;
}

export interface PlannedStatement {
	legacyId: number;
	asset: LegacyRef;
	text: string;
	author: string;
	organization: string;
	editedWith: string;
	savedAt: string;
}

export interface PlannedSignature {
	legacyId: number;
	asset: LegacyRef;
	kind: "asset" | "output";
	version: number;
	source: PlannedFile;
	signed: PlannedFile;
	definition: string;
	statement: string | null;
	report: string | null;
	status: string;
	signerName: string;
	signerIssuer: string;
	timestamped: boolean;
	signedAt: string;
	/** The saved statement this signing used: the asset's, if saved before it. */
	statementLegacyId: number | null;
}

export interface PlannedClip {
	evidence: Evidence;
	track_kind: string;
	track_index: number;
	clip_key: string;
	name: string;
	enabled: boolean;
	start_frame: number;
	end_frame: number;
	in_frame: number | null;
	out_frame: number | null;
	start_seconds: number | null;
	end_seconds: number | null;
	origin_class: string | null;
	sort_order: number;
}

export interface PlannedSource {
	source_key: string;
	kind: string;
	name: string;
	path: string;
	asset: LegacyRef | null;
	match_method: string;
	match_confidence: number;
	clips: PlannedClip[];
}

export interface PlannedTimeline {
	evidence: Evidence;
	/** The output whose file the timeline made. */
	asset: LegacyRef;
	format: string;
	format_version: string;
	file_name: string;
	/** The timeline file, copied into the project as timelines/<sha256>. */
	file: PlannedFile;
	sequence_name: string;
	timebase: number | null;
	ntsc: boolean;
	fps: number | null;
	duration_frames: number | null;
	width: number | null;
	height: number | null;
	primary_track_index: number;
	include_overlays: boolean;
	breakdown: string | null;
	notes: string;
	importedAt: string;
	updatedAt: string;
	sources: PlannedSource[];
}

export interface MigrationPlan {
	project: {
		legacyId: number;
		name: string;
		description: string;
		codePrefix: string;
		cawgIdentityUrl: string;
		cawgIdentityName: string;
		createdAt: string;
		updatedAt: string;
	};
	assets: PlannedAsset[];
	relationships: PlannedRelationship[];
	statements: PlannedStatement[];
	signatures: PlannedSignature[];
	timelines: PlannedTimeline[];
	/** The app's schema migrations in the dump (drizzle), for the record. */
	schemaMigrations: number;
	/** Values with no place in the catalog, each with why. */
	uncarried: UncarriedValue[];
	/** What makes this plan unsafe to write. */
	blocking: string[];
	/** What is worth a look but carried as it was. */
	notes: string[];
}

// Field readers for one row, each naming the column when a value is wrong.

function rowReader(table: string, row: CopyRow) {
	const where = (col: string) => `${table} ${row.id ?? "?"} ${col}`;
	const wrap = <T>(col: string, fn: () => T): T => {
		try {
			return fn();
		} catch (err) {
			throw new Error(`${where(col)}: ${(err as Error).message}`, {
				cause: err,
			});
		}
	};
	return {
		text: (col: string): string => row[col] ?? "",
		textOrNull: (col: string): string | null => row[col] ?? null,
		int: (col: string): number | null => wrap(col, () => pgInteger(row[col])),
		real: (col: string): number | null => wrap(col, () => pgReal(row[col])),
		bool: (col: string): boolean =>
			wrap(col, () => pgBoolean(row[col])) ?? false,
		time: (col: string): string =>
			wrap(col, () => {
				const v = row[col];
				if (v === null) throw new Error("no time");
				return pgTimestamp(v);
			}),
		/** JSON text parsed, for an editable json field; fallback when empty. */
		json: (col: string, fallback: unknown): unknown =>
			wrap(col, () => {
				const v = row[col];
				return v === null || v === "" ? fallback : JSON.parse(v);
			}),
		/** JSON text checked and kept as written. */
		jsonText: (col: string): string | null =>
			wrap(col, () => {
				const v = row[col];
				if (v === null || v === "") return null;
				JSON.parse(v);
				return v;
			}),
	};
}

const SHA256 = /^[0-9a-f]{64}$/;

function fileOf(
	path: string,
	hash: string | null,
	size: number | null,
	where: string,
	notes: string[],
): PlannedFile {
	const sha = (hash ?? "").trim().toLowerCase();
	if (sha && !SHA256.test(sha))
		notes.push(
			`${where}: the stored hash is not a SHA-256 (${hash}); it is ignored`,
		);
	return { path, sha256: SHA256.test(sha) ? sha : null, size };
}

function baseName(path: string): string {
	return path.split(/[\\/]/).at(-1) ?? path;
}

/** Postgres's 0 for "not known" in a count that cannot be 0 becomes null. */
const unknownZero = (n: number | null): number | null => (n === 0 ? null : n);

function rowsOf(tables: Map<string, CopyTable>, name: string): CopyRow[] {
	return tables.get(name)?.rows ?? [];
}

/** The projects in the dump: id and name, for choosing one. */
export function legacyProjects(
	tables: Map<string, CopyTable>,
): Array<{ id: number; name: string }> {
	return rowsOf(tables, "public.projects")
		.map((r) => ({ id: Number(r.id), name: r.name ?? "" }))
		.sort((a, b) => a.id - b.id);
}

/**
 * Plan one project's catalog from the dump's tables.
 * Throws when the dump is not the shape the migration knows.
 */
export function planProject(
	tables: Map<string, CopyTable>,
	projectId: number,
): MigrationPlan {
	checkLegacyShape(tables);
	const blocking: string[] = [];
	const notes: string[] = [];
	const uncarried: UncarriedValue[] = [];

	const projectRow = rowsOf(tables, "public.projects").find(
		(r) => Number(r.id) === projectId,
	);
	if (!projectRow) throw new Error(`The dump has no project ${projectId}`);
	const p = rowReader("public.projects", projectRow);
	uncarried.push(...uncarriedValues("public.projects", [projectRow]));
	for (const table of UNCARRIED_TABLES) {
		const rows = rowsOf(tables, table).filter(
			(r) => !("project_id" in r) || Number(r.project_id) === projectId,
		);
		uncarried.push(...uncarriedValues(table, rows));
	}

	const inProject = (r: CopyRow) => Number(r.project_id) === projectId;

	// Assets, in a fixed order: AI, archival, produced, each by id.
	const assets: PlannedAsset[] = [];
	const byRef = new Map<LegacyRef, PlannedAsset>();
	for (const type of ["ai", "archival", "produced"] as const) {
		const table = LEGACY_TABLE[type];
		const rows = rowsOf(tables, table)
			.filter(inProject)
			.sort((a, b) => Number(a.id) - Number(b.id));
		uncarried.push(...uncarriedValues(table, rows));
		for (const row of rows) {
			const asset = planAsset(type, table, row, notes);
			assets.push(asset);
			byRef.set(asset.ref, asset);
		}
	}

	// What the app read from AI assets, and how they were made.
	for (const row of rowsOf(tables, "public.asset_metadata")) {
		const asset = byRef.get(refOf("ai", row.asset_id ?? ""));
		if (!asset) continue;
		const r = rowReader("public.asset_metadata", row);
		const data = r.jsonText("raw_json");
		if (data === null) continue;
		asset.observations.push({
			kind: `legacy-${r.text("metadata_type")}`,
			data,
			observedAt: r.time("extracted_at"),
			evidence: { legacy: "public.asset_metadata", id: Number(row.id) },
		});
	}
	for (const row of rowsOf(tables, "public.generation_params")) {
		const asset = byRef.get(refOf("ai", row.asset_id ?? ""));
		if (!asset) continue;
		if (asset.generation?.evidence.legacy === "public.generation_params") {
			blocking.push(
				`${asset.ref} has more than one row in public.generation_params`,
			);
			continue;
		}
		const r = rowReader("public.generation_params", row);
		asset.generation = {
			fields: {
				...asset.generation?.fields,
				prompt: r.text("prompt"),
				negative_prompt: r.text("negative_prompt"),
				model_name: r.text("model_name"),
				model_version: r.text("model_version"),
				seed: r.text("seed"),
				steps: unknownZero(r.int("steps")),
				cfg_scale: r.text("cfg_scale"),
				sampler: r.text("sampler"),
				scheduler: r.text("scheduler"),
				width: unknownZero(r.int("width")),
				height: unknownZero(r.int("height")),
				aspect_ratio: r.text("aspect_ratio"),
				stylize: r.text("stylize"),
				style_raw: r.text("style_raw"),
				loras: r.json("loras", []),
				controlnets: r.json("controlnets", []),
				other: r.json("other_params", {}),
			},
			at: r.time("created_at"),
			evidence: { legacy: "public.generation_params", id: Number(row.id) },
		};
	}

	// Links. Postgres had no foreign keys here (D4), so each side is checked.
	const relationships: PlannedRelationship[] = [];
	for (const row of rowsOf(tables, "public.asset_relationships")) {
		const parent = refOf(
			row.parent_asset_type ?? "",
			row.parent_asset_id ?? "",
		);
		const child = refOf(row.child_asset_type ?? "", row.child_asset_id ?? "");
		const hasParent = byRef.has(parent);
		const hasChild = byRef.has(child);
		if (!hasParent && !hasChild) continue; // another project's link
		if (!hasParent || !hasChild) {
			blocking.push(
				`public.asset_relationships ${row.id} links ${parent} and ${child}, but ${hasParent ? child : parent} is not in this project`,
			);
			continue;
		}
		const r = rowReader("public.asset_relationships", row);
		relationships.push({
			parent,
			child,
			fields: {
				type: r.text("relationship_type"),
				match_method: r.text("match_method"),
				confidence: r.real("confidence") ?? 1,
				note: r.text("notes"),
			},
			createdAt: r.time("created_at"),
			evidence: { legacy: "public.asset_relationships", id: Number(row.id) },
		});
	}
	relationships.sort((a, b) => a.evidence.id - b.evidence.id);

	// Statements, then the signings that used them.
	const statements: PlannedStatement[] = [];
	for (const row of rowsOf(tables, "public.creator_statements").filter(
		inProject,
	)) {
		const r = rowReader("public.creator_statements", row);
		const asset = refOf("produced", row.produced_asset_id ?? "");
		uncarried.push(...uncarriedValues("public.creator_statements", [row]));
		if (!byRef.has(asset)) {
			blocking.push(
				`public.creator_statements ${row.id} is for ${asset}, which is not in this project`,
			);
			continue;
		}
		statements.push({
			legacyId: Number(row.id),
			asset,
			text: r.text("text"),
			author: r.text("author_name"),
			organization: r.text("organization"),
			editedWith: r.text("software_agent"),
			savedAt: r.time("updated_at"),
		});
	}
	statements.sort((a, b) => a.legacyId - b.legacyId);

	const signatures: PlannedSignature[] = [];
	for (const row of rowsOf(tables, "public.signatures").filter(inProject)) {
		const r = rowReader("public.signatures", row);
		const asset = refOf(row.asset_type ?? "", row.asset_id ?? "");
		const where = `public.signatures ${row.id}`;
		if (!byRef.has(asset)) {
			blocking.push(`${where} is for ${asset}, which is not in this project`);
			continue;
		}
		const kind = r.text("kind");
		if (kind !== "asset" && kind !== "output") {
			blocking.push(`${where} has the kind "${kind}"`);
			continue;
		}
		const definition = r.jsonText("definition_json") ?? "{}";
		const signedAt = r.time("created_at");
		const used = statements.find(
			(s) => s.asset === asset && s.savedAt <= signedAt,
		);
		signatures.push({
			legacyId: Number(row.id),
			asset,
			kind,
			version: r.int("version") ?? 1,
			source: fileOf(
				r.text("source_path"),
				r.textOrNull("source_hash"),
				null,
				`${where} source`,
				notes,
			),
			signed: fileOf(
				r.text("signed_path"),
				r.textOrNull("signed_hash"),
				r.int("signed_size"),
				`${where} signed copy`,
				notes,
			),
			definition,
			statement: r.jsonText("statement_json"),
			report: r.jsonText("report_json"),
			status: r.text("status"),
			signerName: r.text("signer_name"),
			signerIssuer: r.text("signer_issuer"),
			timestamped: r.bool("timestamped"),
			signedAt,
			statementLegacyId: kind === "output" ? (used?.legacyId ?? null) : null,
		});
	}
	signatures.sort((a, b) => a.legacyId - b.legacyId);

	const timelines = planTimelines(
		tables,
		projectId,
		byRef,
		blocking,
		notes,
		uncarried,
	);

	return {
		project: {
			legacyId: projectId,
			name: p.text("name"),
			description: p.text("description"),
			codePrefix: p.text("asset_id_prefix"),
			cawgIdentityUrl: p.text("cawg_identity_url"),
			cawgIdentityName: p.text("cawg_identity_name"),
			createdAt: p.time("created_at"),
			updatedAt: p.time("updated_at"),
		},
		assets,
		relationships,
		statements,
		signatures,
		timelines,
		schemaMigrations: rowsOf(tables, "drizzle.__drizzle_migrations").length,
		uncarried,
		blocking,
		notes,
	};
}

function planAsset(
	type: LegacyType,
	table: string,
	row: CopyRow,
	notes: string[],
): PlannedAsset {
	const r = rowReader(table, row);
	const id = Number(row.id);
	const ref = refOf(type, id);
	const filePath = r.text("file_path");
	const fields: Record<string, unknown> = {
		kind: KIND[type],
		public_title: r.text("public_title"),
		origin_class: r.text("origin_class") || "unknown",
		origin_class_confirmed: r.bool("origin_class_confirmed"),
		origin_class_source: r.text("origin_class_source"),
		origin_class_note: r.text("origin_class_note"),
		origin_ingredient_classes: r.json("origin_ingredient_classes", []),
		ai_assisted: r.bool("ai_assisted"),
		signed_by: r.text("signed_by"),
		signer_name: r.text("signer_name"),
	};
	const credits: PlannedAsset["credits"] = [];
	const observations: PlannedObservation[] = [];
	let generation: PlannedAsset["generation"] = null;

	if (type === "ai") {
		fields.code = r.textOrNull("asset_id") || null;
		fields.description = r.text("description");
		fields.notes = r.text("notes");
		const dst = r.text("digital_source_type");
		if (dst && dst !== fields.origin_class)
			notes.push(
				`${ref}: digital_source_type is "${dst}" but origin_class is "${String(fields.origin_class)}"; origin_class is carried`,
			);
		const platform = r.text("platform");
		const generatedAt = r.text("generation_date");
		if ((platform && platform !== "unknown") || generatedAt)
			generation = {
				fields: { platform, generated_at: generatedAt },
				at: r.time("updated_at"),
				evidence: { legacy: table, id },
			};
	} else {
		fields.title = r.text("name");
		fields.usage_notes = r.text("usage_notes");
		const filename = r.text("filename");
		if (filename && filename !== baseName(filePath))
			notes.push(
				`${ref}: filename is "${filename}" but the file is "${baseName(filePath)}"; the file is what is tracked`,
			);
		const creator = r.text("creator");
		if (creator) credits.push({ role: "creator", name: creator });
		const at = r.time("created_at");
		const exif = r.jsonText("exif_json");
		if (exif !== null && exif !== "{}")
			observations.push({
				kind: "legacy-exif",
				data: exif,
				observedAt: at,
				evidence: { legacy: table, id, column: "exif_json" },
			});
		const c2pa = r.jsonText("c2pa_json");
		if (c2pa !== null)
			observations.push({
				kind: "legacy-c2pa",
				data: c2pa,
				observedAt: at,
				evidence: { legacy: table, id, column: "c2pa_json" },
			});
	}
	if (type === "archival") {
		const institution = r.text("institution");
		if (institution) credits.push({ role: "institution", name: institution });
		Object.assign(fields, {
			source_url: r.text("source_url"),
			access_date: r.text("access_date"),
			license: r.text("license"),
			license_url: r.text("license_url"),
			caption: r.text("caption"),
			original_date: r.text("original_date"),
			medium: r.text("medium"),
		});
	}
	if (type === "produced")
		Object.assign(fields, {
			description: r.text("description"),
			recorded_date: r.text("recording_date"),
			recorded_location: r.text("location"),
			equipment: r.text("equipment"),
			is_output: r.bool("is_output"),
			output_source: r.text("output_source"),
		});

	return {
		ref,
		evidence: { legacy: table, id },
		createdAt: r.time("created_at"),
		updatedAt: r.time("updated_at"),
		fields,
		file: fileOf(
			filePath,
			r.textOrNull("file_hash"),
			r.int("file_size"),
			ref,
			notes,
		),
		credits,
		generation,
		observations,
	};
}

function planTimelines(
	tables: Map<string, CopyTable>,
	projectId: number,
	byRef: Map<LegacyRef, PlannedAsset>,
	blocking: string[],
	notes: string[],
	uncarried: UncarriedValue[],
): PlannedTimeline[] {
	const out: PlannedTimeline[] = [];
	const segments = rowsOf(tables, "public.timeline_segments");
	const rows = rowsOf(tables, "public.timelines")
		.filter((r) => Number(r.project_id) === projectId)
		.sort((a, b) => Number(a.id) - Number(b.id));
	for (const row of rows) {
		const r = rowReader("public.timelines", row);
		const id = Number(row.id);
		const where = `public.timelines ${id}`;
		const asset = refOf("produced", row.produced_asset_id ?? "");
		if (!byRef.has(asset)) {
			blocking.push(`${where} is for ${asset}, which is not in this project`);
			continue;
		}
		const clipsOf = segments
			.filter((s) => Number(s.timeline_id) === id)
			.sort((a, b) => Number(a.id) - Number(b.id));
		uncarried.push(...uncarriedValues("public.timeline_segments", clipsOf));
		const sources = new Map<string, PlannedSource>();
		for (const seg of clipsOf) {
			const s = rowReader("public.timeline_segments", seg);
			const key = s.text("source_key");
			const matched =
				seg.matched_asset_type && seg.matched_asset_id
					? refOf(seg.matched_asset_type, seg.matched_asset_id)
					: null;
			if (matched && !byRef.has(matched)) {
				blocking.push(
					`public.timeline_segments ${seg.id} is matched to ${matched}, which is not in this project`,
				);
				continue;
			}
			const source: Omit<PlannedSource, "clips"> = {
				source_key: key,
				kind: s.text("source_kind") || "file",
				name: s.text("source_name"),
				path: s.text("source_path"),
				asset: matched,
				match_method: s.text("match_method") || "unmatched",
				match_confidence: s.real("match_confidence") ?? 0,
			};
			let planned = sources.get(key);
			if (!planned) {
				planned = { ...source, clips: [] };
				sources.set(key, planned);
			} else {
				const differs = (
					Object.keys(source) as Array<keyof typeof source>
				).filter((k) => planned![k] !== source[k]);
				if (differs.length) {
					blocking.push(
						`${where}: clips of the source "${key}" disagree on ${differs.join(", ")} (segment ${seg.id}); the catalog matches per source`,
					);
					continue;
				}
			}
			planned.clips.push({
				evidence: { legacy: "public.timeline_segments", id: Number(seg.id) },
				track_kind: s.text("track_kind"),
				track_index: s.int("track_index") ?? 1,
				clip_key: s.text("clip_id"),
				name: s.text("clip_name"),
				enabled: s.bool("enabled"),
				start_frame: s.int("start_frame") ?? 0,
				end_frame: s.int("end_frame") ?? 0,
				in_frame: s.int("in_frame"),
				out_frame: s.int("out_frame"),
				start_seconds: s.real("start_seconds"),
				end_seconds: s.real("end_seconds"),
				origin_class: s.textOrNull("origin_class"),
				sort_order: s.int("sort_order") ?? 0,
			});
		}
		const fileHash = r.textOrNull("source_file_hash");
		const file = fileOf(
			r.text("source_file_path"),
			fileHash,
			null,
			where,
			notes,
		);
		if (!file.sha256)
			blocking.push(`${where} has no SHA-256 of its timeline file`);
		out.push({
			evidence: { legacy: "public.timelines", id },
			asset,
			format: r.text("source_format"),
			format_version: r.text("source_format_version"),
			file_name: r.text("source_file_name"),
			file,
			sequence_name: r.text("sequence_name"),
			timebase: r.int("timebase"),
			ntsc: r.bool("ntsc"),
			fps: r.real("fps"),
			duration_frames: r.int("duration_frames"),
			width: r.int("width"),
			height: r.int("height"),
			primary_track_index: r.int("primary_track_index") ?? 1,
			include_overlays: r.bool("include_overlays"),
			breakdown: r.jsonText("breakdown_json"),
			notes: r.jsonText("notes_json") ?? "[]",
			importedAt: r.time("created_at"),
			updatedAt: r.time("updated_at"),
			sources: [...sources.values()],
		});
	}
	return out;
}
