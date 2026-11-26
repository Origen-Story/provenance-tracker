// What the app and the command line read from a catalog: a project's summary,
// a filtered list of assets, and everything known about one asset. Reads only.
//
// Values come back as the catalog holds them, under the catalog's own field
// names (the edit functions take the same names), with booleans as true and
// false and JSON columns parsed. Large data (what an extractor read) is left
// out of the asset record; it is asked for one observation at a time.

import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { EDITABLE, EDITABLE_META } from "./fields.ts";
import { ORIGIN_CLASS_DEFS, POSITIONS } from "../origin-vocabulary.js";
import { readIdentity } from "../manifest/identity.ts";
import { interpretReport } from "../manifest/verify.js";
import { publicationOf } from "./publications.ts";

/** The identity a stored reading shows, by name and verdict (D55). */
function identityOf(
	report: string | null,
): { name: string; status: string } | null {
	if (!report) return null;
	try {
		const reading = readIdentity(JSON.parse(report));
		return reading ? { name: reading.name, status: reading.status } : null;
	} catch {
		return null;
	}
}

type Row = Record<string, unknown>;

const bool = (v: unknown) => v === 1 || v === true;
const json = (v: unknown, fallback: unknown = null) => {
	if (typeof v !== "string") return fallback;
	try {
		return JSON.parse(v);
	} catch {
		return fallback;
	}
};

/** A row's editable fields as their logical values (booleans, parsed JSON). */
function fieldsOf(table: string, row: Row): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [field, spec] of Object.entries(EDITABLE[table].fields)) {
		const v = row[field];
		out[field] =
			spec.type === "boolean" ? bool(v) : spec.type === "json" ? json(v) : v;
	}
	return out;
}

export interface ProjectSummary {
	projectId: string;
	/** The editable project settings (name, description, author, ...). */
	settings: Record<string, string>;
	counts: {
		assets: number;
		byKind: Record<string, number>;
		unsorted: number;
		outputs: number;
		removed: number;
	};
	/** The newest finished run of each kind. */
	lastRuns: Array<{
		kind: string;
		finishedAt: string | null;
		outcome: string | null;
	}>;
}

export function projectSummary(db: DatabaseSync): ProjectSummary {
	const meta = new Map(
		(
			db.prepare("SELECT key, value FROM meta").all() as Array<{
				key: string;
				value: string;
			}>
		).map((r) => [r.key, r.value]),
	);
	const settings: Record<string, string> = {};
	for (const key of EDITABLE_META) settings[key] = meta.get(key) ?? "";
	const byKind: Record<string, number> = {};
	for (const r of db
		.prepare(
			"SELECT kind, count(*) AS n FROM assets WHERE removed_at IS NULL GROUP BY kind ORDER BY kind",
		)
		.all() as Array<{ kind: string; n: number }>)
		byKind[r.kind] = r.n;
	const count = (where: string) =>
		(
			db.prepare(`SELECT count(*) AS n FROM assets WHERE ${where}`).get() as {
				n: number;
			}
		).n;
	return {
		projectId: meta.get("project_id") ?? "",
		settings,
		counts: {
			assets: count("removed_at IS NULL"),
			byKind,
			unsorted: byKind.unsorted ?? 0,
			outputs: count("removed_at IS NULL AND is_output = 1"),
			removed: count("removed_at IS NOT NULL"),
		},
		lastRuns: db
			.prepare(
				`SELECT kind, finished_at AS finishedAt, outcome FROM runs r
				 WHERE id = (SELECT max(id) FROM runs x WHERE x.kind = r.kind) ORDER BY kind`,
			)
			.all() as ProjectSummary["lastRuns"],
	};
}

/** One place a file is, by root name. */
export interface FilePlace {
	root: string;
	path: string;
}

export interface AssetSummary {
	id: number;
	code: string | null;
	kind: string;
	title: string;
	publicTitle: string;
	/** The title, or the file's name when it has none. */
	displayTitle: string;
	originClass: string;
	originClassConfirmed: boolean;
	isOutput: boolean;
	aiAssisted: boolean;
	/** Its current file: the newest of its own versions (not a signed copy) with a place. */
	file: (FilePlace & { sha256: string; size: number }) | null;
	versions: number;
	updatedAt: string;
	removedAt: string | null;
}

export interface AssetFilter {
	kind?: string;
	originClass?: string;
	/**
	 * A spectrum position (origin-vocabulary.js POSITIONS): every class in it,
	 * with a digital class marked AI-assisted counted as assisted, as the
	 * badges show it.
	 */
	position?: string;
	outputs?: boolean;
	/** Words to find in titles, notes, captions, credits or file paths. */
	q?: string;
	/** Include removed assets, or show only them (default: only those not removed). */
	removed?: boolean | "only";
	limit?: number;
	offset?: number;
}

/**
 * Text for an FTS5 MATCH from what a person typed: each word quoted (so
 * nothing they type is read as query syntax) and matched as a prefix.
 */
export function ftsQuery(text: string): string | null {
	const words = text
		.split(/\s+/)
		.map((w) => w.replaceAll('"', ""))
		.filter(Boolean);
	if (!words.length) return null;
	return words.map((w) => `"${w}"*`).join(" ");
}

const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/**
 * The asset's current file: its newest content that is not a signed copy
 * and has a live place; else its newest content with a live place.
 */
const CURRENT_FILE = `
	SELECT c.sha256, c.size, r.name AS root, l.path,
	       EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256) AS signed_copy
	FROM contents c
	JOIN locations l ON l.content_sha256 = c.sha256 AND l.gone_run_id IS NULL
	JOIN roots r ON r.id = l.root_id
	WHERE c.asset_id = ?
	ORDER BY signed_copy, c.created_at DESC, c.rowid DESC, l.path
	LIMIT 1`;

const codesAt = (position: string): string[] =>
	(ORIGIN_CLASS_DEFS as Array<{ code: string; position: string }>)
		.filter((d) => d.position === position)
		.map((d) => d.code);
const list = (codes: string[]) => codes.map(() => "?").join(", ");

/** The assets at one spectrum position, by the rule spectrumPosition applies. */
function positionClause(position: string): { sql: string; params: string[] } {
	if (!(POSITIONS as Array<{ id: string }>).some((p) => p.id === position))
		return { sql: "0", params: [] };
	const digital = codesAt("digital");
	if (position === "digital")
		return {
			sql: `(a.origin_class IN (${list(digital)}) AND a.ai_assisted = 0)`,
			params: digital,
		};
	if (position === "assisted") {
		const own = codesAt("assisted");
		return {
			sql: `(a.origin_class IN (${list(own)}) OR (a.origin_class IN (${list(digital)}) AND a.ai_assisted = 1))`,
			params: [...own, ...digital],
		};
	}
	// A class the vocabulary does not know reads as unknown (originClassDef).
	if (position === "unknown") {
		const placed = (
			ORIGIN_CLASS_DEFS as Array<{ code: string; position: string }>
		)
			.filter((d) => d.position !== "unknown")
			.map((d) => d.code);
		return { sql: `a.origin_class NOT IN (${list(placed)})`, params: placed };
	}
	const codes = codesAt(position);
	return { sql: `a.origin_class IN (${list(codes)})`, params: codes };
}

export function listAssets(
	db: DatabaseSync,
	filter: AssetFilter = {},
): { total: number; assets: AssetSummary[] } {
	const where: string[] = [];
	const params: SQLInputValue[] = [];
	if (filter.removed === "only") where.push("a.removed_at IS NOT NULL");
	else if (!filter.removed) where.push("a.removed_at IS NULL");
	if (filter.kind) {
		where.push("a.kind = ?");
		params.push(filter.kind);
	}
	if (filter.originClass) {
		where.push("a.origin_class = ?");
		params.push(filter.originClass);
	}
	if (filter.position) {
		const { sql, params: p } = positionClause(filter.position);
		where.push(sql);
		params.push(...p);
	}
	if (filter.outputs) where.push("a.is_output = 1");
	const q = filter.q?.trim();
	if (q) {
		const match = ftsQuery(q);
		const like = `%${q.toLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
		where.push(`(
			${match ? "a.id IN (SELECT rowid FROM assets_text WHERE assets_text MATCH ?) OR a.id IN (SELECT c.asset_id FROM credits c WHERE c.id IN (SELECT rowid FROM credits_text WHERE credits_text MATCH ?)) OR" : ""}
			a.id IN (SELECT c.asset_id FROM contents c JOIN locations l ON l.content_sha256 = c.sha256
			         WHERE l.gone_run_id IS NULL AND lower(l.path) LIKE ? ESCAPE '\\')
			OR lower(coalesce(a.code, '')) LIKE ? ESCAPE '\\'
		)`);
		if (match) params.push(match, match);
		params.push(like, like);
	}
	const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
	const total = (
		db
			.prepare(`SELECT count(*) AS n FROM assets a ${clause}`)
			.get(...params) as { n: number }
	).n;
	const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
	const offset = Math.max(filter.offset ?? 0, 0);
	const rows = db
		.prepare(
			`SELECT a.*, (SELECT count(*) FROM contents c WHERE c.asset_id = a.id
			   AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)) AS versions
			 FROM assets a ${clause} ORDER BY a.id LIMIT ? OFFSET ?`,
		)
		.all(...params, limit, offset) as Row[];
	const current = db.prepare(CURRENT_FILE);
	return {
		total,
		assets: rows.map((a) => {
			const f = current.get(a.id as number) as Row | undefined;
			const file = f
				? {
						root: f.root as string,
						path: f.path as string,
						sha256: f.sha256 as string,
						size: f.size as number,
					}
				: null;
			const title = a.title as string;
			return {
				id: a.id as number,
				code: (a.code as string | null) ?? null,
				kind: a.kind as string,
				title,
				publicTitle: a.public_title as string,
				displayTitle: title || (file ? fileName(file.path) : `Asset ${a.id}`),
				originClass: a.origin_class as string,
				originClassConfirmed: bool(a.origin_class_confirmed),
				isOutput: bool(a.is_output),
				aiAssisted: bool(a.ai_assisted),
				file,
				versions: a.versions as number,
				updatedAt: a.updated_at as string,
				removedAt: (a.removed_at as string | null) ?? null,
			};
		}),
	};
}

/**
 * What a reading of a file's Content Credentials comes to, for a person: who
 * the credentials name, whether the reader could verify that, and if not,
 * why, in the reader's own words. The name is what the file says; only
 * `verdict` says whether anything stands behind it (D67).
 */
export interface CredentialsRead {
	signer: string;
	issuer: string;
	/** The program the credentials say made them. */
	generator: string;
	/** "valid", "unrecognised_issuer", "hash_mismatch" or "invalid" (manifest/verify.js). */
	verdict: string;
	label: string;
	/** Whether the file is still the bytes that were signed. */
	contentMatches: boolean;
	failures: Array<{ code: string; explanation: string }>;
}

function credentialsRead(data: string | null): CredentialsRead | undefined {
	if (!data) return undefined;
	let store: Record<string, unknown>;
	try {
		store = JSON.parse(data) as Record<string, unknown>;
	} catch {
		return undefined;
	}
	const v = interpretReport(store) as {
		status: string;
		label: string;
		hashVerified: boolean;
		failures: Array<{ code: string; explanation: string }>;
		signer: { commonName: string; issuer: string } | null;
	};
	if (v.status === "absent") return undefined;
	const active = (
		store.manifests as Record<string, Record<string, unknown>> | undefined
	)?.[String(store.active_manifest)];
	const info = (
		active?.claim_generator_info as Array<{ name?: string }> | undefined
	)?.[0];
	return {
		signer: v.signer?.commonName ?? "",
		issuer: v.signer?.issuer ?? "",
		generator: String(info?.name ?? active?.claim_generator ?? ""),
		verdict: v.status,
		label: v.label,
		contentMatches: v.hashVerified,
		failures: v.failures,
	};
}

export interface AssetRecord {
	id: number;
	/** The asset's editable fields (catalog/fields.ts), as their logical values. */
	fields: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	contents: Array<{
		sha256: string;
		size: number;
		createdAt: string;
		/** Made by a signing recorded here. */
		signedCopy: boolean;
		places: Array<FilePlace & { live: boolean }>;
		/** Technical values from its newest ExifTool reading, or null. */
		technical: Record<string, unknown> | null;
		/** The newest reading of each kind (data left out). */
		readings: Array<{
			id: number;
			kind: string;
			extractor: string;
			version: string;
			status: string;
			observedAt: string;
			fromSidecar: boolean;
			/** For a reading of Content Credentials that found some: what it comes to. */
			credentials?: CredentialsRead;
		}>;
	}>;
	credits: Array<Record<string, unknown> & { id: number }>;
	generation: Record<string, unknown> | null;
	relationships: Array<{
		id: number;
		direction: "parent" | "child";
		otherAssetId: number;
		otherTitle: string;
		type: string;
		matchMethod: string;
		confidence: number;
		note: string;
	}>;
	timelines: Array<{
		id: number;
		contentSha256: string;
		fileName: string;
		sequenceName: string;
		importedAt: string;
	}>;
	statements: Array<{
		id: number;
		text: string;
		author: string;
		organization: string;
		editedWith: string;
		savedAt: string;
	}>;
	signatures: Array<{
		id: number;
		kind: string;
		version: number;
		sourceSha256: string;
		signedSha256: string;
		engine: string;
		engineVersion: string;
		signerName: string;
		/** The creator's identity the copy carries, as its reading says (D55); null without one. */
		identity: { name: string; status: string } | null;
		status: string;
		timestamped: boolean;
		signedAt: string;
		/** Where this signed copy is published (D56); null if never. */
		publication: { fileUrl: string; pageUrl: string } | null;
	}>;
	/** The newest changes to the asset's own fields, newest first. */
	history: Array<{
		at: string;
		actorKind: string;
		actor: string;
		field: string;
		oldValue: unknown;
		newValue: unknown;
		note: string;
	}>;
}

export function assetRecord(
	db: DatabaseSync,
	id: number,
	opts: { historyLimit?: number } = {},
): AssetRecord | null {
	const a = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
		Row | undefined;
	if (!a) return null;
	const signed = new Set(
		(
			db
				.prepare(
					"SELECT s.signed_sha256 AS sha FROM signatures s WHERE s.asset_id = ?",
				)
				.all(id) as Array<{ sha: string }>
		).map((r) => r.sha),
	);
	const places = db.prepare(
		`SELECT r.name AS root, l.path, l.gone_run_id IS NULL AS live FROM locations l
		 JOIN roots r ON r.id = l.root_id WHERE l.content_sha256 = ? ORDER BY live DESC, l.id DESC`,
	);
	const technical = db.prepare(
		`SELECT mime_type, duration_seconds, width, height, frame_rate, video_codec, audio_codec,
		        sample_rate, channels, bits_per_sample, exiftool_version
		 FROM technical WHERE content_sha256 = ?`,
	);
	const readings = db.prepare(
		`SELECT o.id, o.kind, o.extractor, o.extractor_version AS version, o.status,
		        o.observed_at AS observedAt, o.source_sha256 IS NOT NULL AS fromSidecar,
		        CASE WHEN o.kind IN ('c2pa', 'c2pa-sidecar') AND o.status = 'ok' THEN o.data END AS credentials
		 FROM observations o
		 WHERE o.content_sha256 = ? AND o.id = (SELECT max(x.id) FROM observations x
		   WHERE x.content_sha256 = o.content_sha256 AND x.kind = o.kind)
		 ORDER BY o.kind`,
	);
	const contents = (
		db
			.prepare(
				"SELECT sha256, size, created_at FROM contents WHERE asset_id = ? ORDER BY created_at, rowid",
			)
			.all(id) as Array<{ sha256: string; size: number; created_at: string }>
	).map((c) => ({
		sha256: c.sha256,
		size: c.size,
		createdAt: c.created_at,
		signedCopy: signed.has(c.sha256),
		places: (places.all(c.sha256) as Row[]).map((p) => ({
			root: p.root as string,
			path: p.path as string,
			live: bool(p.live),
		})),
		technical: (technical.get(c.sha256) as Row | undefined) ?? null,
		readings: (readings.all(c.sha256) as Row[]).map((r) => ({
			id: r.id as number,
			kind: r.kind as string,
			extractor: r.extractor as string,
			version: r.version as string,
			status: r.status as string,
			observedAt: r.observedAt as string,
			fromSidecar: bool(r.fromSidecar),
			...(r.credentials
				? { credentials: credentialsRead(r.credentials as string) }
				: {}),
		})),
	}));
	const generation = db
		.prepare("SELECT * FROM generation WHERE asset_id = ?")
		.get(id) as Row | undefined;
	const titleOf = (other: number) => {
		const t = db.prepare("SELECT title FROM assets WHERE id = ?").get(other) as
			{ title: string } | undefined;
		if (t?.title) return t.title;
		const f = db.prepare(CURRENT_FILE).get(other) as Row | undefined;
		return f ? fileName(f.path as string) : `Asset ${other}`;
	};
	const relationships = (
		db
			.prepare(
				"SELECT * FROM relationships WHERE parent_id = ? OR child_id = ? ORDER BY id",
			)
			.all(id, id) as Row[]
	).map((r) => {
		const parent = r.parent_id === id;
		const other = (parent ? r.child_id : r.parent_id) as number;
		return {
			id: r.id as number,
			// The direction of the other asset, seen from this one.
			direction: (parent ? "child" : "parent") as "parent" | "child",
			otherAssetId: other,
			otherTitle: titleOf(other),
			type: r.type as string,
			matchMethod: r.match_method as string,
			confidence: r.confidence as number,
			note: r.note as string,
		};
	});
	return {
		id,
		fields: fieldsOf("assets", a),
		createdAt: a.created_at as string,
		updatedAt: a.updated_at as string,
		contents,
		credits: (
			db
				.prepare(
					"SELECT * FROM credits WHERE asset_id = ? ORDER BY sort_order, id",
				)
				.all(id) as Row[]
		).map((c) => ({ id: c.id as number, ...fieldsOf("credits", c) })),
		generation: generation ? fieldsOf("generation", generation) : null,
		relationships,
		timelines: db
			.prepare(
				`SELECT t.id, t.content_sha256 AS contentSha256, t.file_name AS fileName,
				        t.sequence_name AS sequenceName, t.imported_at AS importedAt
				 FROM timelines t JOIN contents c ON c.sha256 = t.content_sha256
				 WHERE c.asset_id = ? ORDER BY t.id`,
			)
			.all(id) as AssetRecord["timelines"],
		statements: db
			.prepare(
				`SELECT id, text, author, organization, edited_with AS editedWith, saved_at AS savedAt
				 FROM statements WHERE asset_id = ? ORDER BY id DESC`,
			)
			.all(id) as AssetRecord["statements"],
		signatures: (
			db
				.prepare(
					`SELECT id, kind, version, source_sha256, signed_sha256, engine, engine_version, signer_name, report,
					        status, timestamped, signed_at FROM signatures WHERE asset_id = ? ORDER BY id`,
				)
				.all(id) as Row[]
		).map((s) => ({
			id: s.id as number,
			kind: s.kind as string,
			version: s.version as number,
			sourceSha256: s.source_sha256 as string,
			signedSha256: s.signed_sha256 as string,
			engine: s.engine as string,
			engineVersion: s.engine_version as string,
			signerName: s.signer_name as string,
			identity: identityOf(s.report as string | null),
			status: s.status as string,
			timestamped: bool(s.timestamped),
			signedAt: s.signed_at as string,
			publication: publishedAt(db, s.id as number),
		})),
		history: (
			db
				.prepare(
					`SELECT at, actor_kind, actor, field, old_value, new_value, note FROM history
					 WHERE table_name = 'assets' AND row_key = ? ORDER BY id DESC LIMIT ?`,
				)
				.all(String(id), opts.historyLimit ?? 50) as Row[]
		).map((h) => ({
			at: h.at as string,
			actorKind: h.actor_kind as string,
			actor: h.actor as string,
			field: h.field as string,
			oldValue: json(h.old_value),
			newValue: json(h.new_value),
			note: h.note as string,
		})),
	};
}

/** A signed copy's web addresses, as an asset's record shows them. */
function publishedAt(
	db: DatabaseSync,
	signatureId: number,
): { fileUrl: string; pageUrl: string } | null {
	const p = publicationOf(db, signatureId);
	return p ? { fileUrl: p.fileUrl, pageUrl: p.pageUrl } : null;
}
