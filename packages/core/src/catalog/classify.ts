// classify: what each asset is, from what its file said (roadmap Phase 6,
// D37). Pure: SQL on a catalog it is handed. It reads observations only,
// never files, so it can be run again whenever extract has read more.
//
// For each asset it takes its own newest file (never a signed copy), that
// file's newest readings (ExifTool, PNG text, and C2PA: the embedded manifest,
// else a .c2pa sidecar's), and runs the existing platform detector and class
// proposer on them:
//
// - kind, only for an unsorted asset: a recognised AI platform, or a manifest
//   saying a model made it, means generated; a manifest from a capture device
//   means produced. Anything else stays unsorted for a person to decide.
// - origin class and its source rule, and who signed the file.
// - generation details, for a generated asset that has none yet.
//
// It changes only what a tool set, or nothing has: a field whose latest
// change was a person's or came from the legacy import is left alone, and so
// is the class once a person has confirmed it. (A value the legacy import
// carried at its column's default left no history, so it counts as unset.) Every change is a tool edit
// naming its run, with the rule and the readings it rests on as evidence.

import type { DatabaseSync } from "node:sqlite";
import { c2paSummaryOf } from "../extraction/c2pa-summary.ts";
import { detectAndParse } from "../extraction/detect.js";
import type { Observation } from "../extraction/observation.ts";
import { proposeOriginClass } from "../origin/classify.js";
import type { Tool } from "./create.ts";
import { createRow, editRow, type Actor } from "./edit.ts";
import { inTransaction } from "./format.ts";
import { finishRun, startRun } from "./runs.ts";

/** One field an asset's classification would change. */
export interface FieldChange {
	field: string;
	from: unknown;
	to: unknown;
}

export interface AssetClassification {
	assetId: number;
	/** The content its readings came from; null when it has none. */
	contentSha256: string | null;
	platform: string;
	/** The proposer's rule ("c2pa_capture_action", "platform_parser", ...). */
	rule: string;
	changes: FieldChange[];
	/** Generation details to add, when the asset is generated and has none. */
	generation: Record<string, unknown> | null;
	/** Fields left alone because a person or the legacy import set them. */
	kept: Array<{ field: string; by: "person" | "legacy" | "confirmed" }>;
	evidence: Record<string, unknown>;
}

const LEGACY_TABLE: Record<string, "ai" | "archival" | "produced" | undefined> =
	{ generated: "ai", archival: "archival", produced: "produced" };

const GENERATED_RULES = new Set([
	"c2pa_generated_action",
	"c2pa_generated_from_empty",
]);
const CAPTURE_RULES = new Set(["c2pa_capture_action", "c2pa_capture_device"]);

type Row = Record<string, unknown>;

interface Reading {
	id: number;
	status: Observation["status"];
	data: unknown;
	error: string | null;
	validation: Observation["validation"];
}

/** An ExifTool date ("2026:10:15 12:00:00", or one kept as { rawValue }) as YYYY-MM-DD; "" when there is none. */
export function exifDate(value: unknown): string {
	const raw =
		typeof value === "string"
			? value
			: value && typeof value === "object" && "rawValue" in value
				? String((value as { rawValue: unknown }).rawValue)
				: "";
	const m = /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(raw);
	if (!m || m[1] === "0000") return "";
	return `${m[1]}-${m[2]}-${m[3]}`;
}

/** A platform parser's output as the catalog's generation fields. */
export function generationFields(
	platform: string,
	data: Record<string, unknown>,
	exif: Record<string, unknown>,
): Record<string, unknown> {
	const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));
	const count = (v: unknown) =>
		Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
	const list = (v: unknown) => (Array.isArray(v) ? v : []);
	const other = data.otherParams;
	return {
		platform,
		model_name: text(data.modelName),
		model_version: text(data.modelVersion),
		prompt: text(data.prompt),
		negative_prompt: text(data.negativePrompt),
		seed: text(data.seed),
		steps: count(data.steps),
		cfg_scale: text(data.cfgScale),
		sampler: text(data.sampler),
		scheduler: text(data.scheduler),
		width: count(data.width),
		height: count(data.height),
		aspect_ratio: text(data.aspectRatio),
		stylize: text(data.stylize),
		style_raw: text(data.styleRaw),
		loras: list(data.loras),
		controlnets: list(data.controlnets),
		other: other && typeof other === "object" ? other : {},
		generated_at:
			exifDate(exif.DateTimeOriginal) ||
			exifDate(exif.CreateDate) ||
			exifDate(exif.ModifyDate),
	};
}

/** Who last set a field of an asset: a person, a tool, the legacy import, or nobody. */
function setBy(
	db: DatabaseSync,
	assetId: number,
	field: string,
): "person" | "tool" | "legacy" | null {
	const row = db
		.prepare(
			"SELECT actor_kind FROM history WHERE table_name = 'assets' AND row_key = ? AND field = ? ORDER BY id DESC LIMIT 1",
		)
		.get(String(assetId), field) as { actor_kind: string } | undefined;
	return (row?.actor_kind as "person" | "tool" | "legacy" | undefined) ?? null;
}

/** The asset's own newest content: not a signed copy, newest first. */
function ownContent(db: DatabaseSync, assetId: number): string | null {
	const row = db
		.prepare(
			`SELECT c.sha256 FROM contents c WHERE c.asset_id = ?
			   AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)
			 ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`,
		)
		.get(assetId) as { sha256: string } | undefined;
	return row?.sha256 ?? null;
}

function newestReading(
	db: DatabaseSync,
	sha256: string,
	kind: string,
): Reading | null {
	const row = db
		.prepare(
			`SELECT id, status, data, error, validation FROM observations
			 WHERE content_sha256 = ? AND kind = ? ORDER BY id DESC LIMIT 1`,
		)
		.get(sha256, kind) as Row | undefined;
	if (!row) return null;
	const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : null);
	return {
		id: row.id as number,
		status: row.status as Observation["status"],
		data: parse(row.data),
		error: (row.error as string | null) ?? null,
		validation: parse(row.validation),
	};
}

/** The class of a derived_from parent (an upscale's source), for the modifier rule. */
function parentClass(db: DatabaseSync, assetId: number): string | null {
	const row = db
		.prepare(
			`SELECT a.origin_class FROM relationships r JOIN assets a ON a.id = r.parent_id
			 WHERE r.child_id = ? AND r.type = 'derived_from' ORDER BY r.id LIMIT 1`,
		)
		.get(assetId) as { origin_class: string } | undefined;
	return row?.origin_class ?? null;
}

/** What classify would do to one asset. Reads only. */
export function classifyAsset(
	db: DatabaseSync,
	assetId: number,
): AssetClassification | null {
	const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as
		Row | undefined;
	if (!asset || asset.removed_at !== null) return null;
	const sha = ownContent(db, assetId);
	const exif = sha ? newestReading(db, sha, "exif") : null;
	const png = sha ? newestReading(db, sha, "png-text") : null;
	let c2pa = sha ? newestReading(db, sha, "c2pa") : null;
	if (
		sha &&
		(!c2pa || c2pa.status === "absent" || c2pa.status === "unavailable")
	) {
		const sidecar = newestReading(db, sha, "c2pa-sidecar");
		if (sidecar && (sidecar.status === "ok" || sidecar.status === "unreadable"))
			c2pa = sidecar;
	}
	const exifTags = (exif?.status === "ok" ? exif.data : null) as Record<
		string,
		unknown
	> | null;
	const chunks = (png?.status === "ok" ? png.data : {}) as Record<
		string,
		string
	>;
	const detected = detectAndParse(exifTags ?? {}, chunks) as {
		platform: string;
		data: Record<string, unknown>;
	};
	const signals = {
		c2paSummary: c2paSummaryOf(c2pa),
		exifTags,
		platform: detected.platform,
		platformData: detected.platform === "unknown" ? null : detected.data,
		parentClass: parentClass(db, assetId),
	};

	// Kind first, for an unsorted asset: the class rules depend on it.
	let kind = asset.kind as string;
	const plain = proposeOriginClass({ table: undefined, ...signals });
	const isModifier = plain.source.startsWith("modifier_");
	let kindRule: string | null = null;
	if (kind === "unsorted") {
		if (detected.platform !== "unknown" && !isModifier) {
			kind = "generated";
			kindRule = "platform_parser";
		} else if (GENERATED_RULES.has(plain.source)) {
			kind = "generated";
			kindRule = plain.source;
		} else if (CAPTURE_RULES.has(plain.source)) {
			kind = "produced";
			kindRule = plain.source;
		}
	}
	const proposal = proposeOriginClass({
		table: LEGACY_TABLE[kind],
		...signals,
	});

	const out: AssetClassification = {
		assetId,
		contentSha256: sha,
		platform: detected.platform,
		rule: proposal.source,
		changes: [],
		generation: null,
		kept: [],
		evidence: {
			rule: proposal.source,
			...(kindRule ? { kind_rule: kindRule } : {}),
			content: sha,
			readings: Object.fromEntries(
				(
					[
						["exif", exif],
						["png-text", png],
						["c2pa", c2pa],
					] as const
				)
					.filter(([, r]) => r !== null)
					.map(([k, r]) => [k, r!.id]),
			),
			platform: detected.platform,
		},
	};
	const propose = (field: string, to: unknown) => {
		if (asset[field] === to) return;
		const by = setBy(db, assetId, field);
		if (by === "person" || by === "legacy") {
			out.kept.push({ field, by });
			return;
		}
		out.changes.push({ field, from: asset[field], to });
	};
	if (kind !== asset.kind) propose("kind", kind);
	// The class and the rule that chose it go together: whoever set the class
	// decides whether classify may touch either.
	const classBy = setBy(db, assetId, "origin_class");
	if (asset.origin_class_confirmed === 1) {
		if (asset.origin_class !== proposal.originClass)
			out.kept.push({ field: "origin_class", by: "confirmed" });
	} else if (classBy === "person" || classBy === "legacy") {
		if (asset.origin_class !== proposal.originClass)
			out.kept.push({ field: "origin_class", by: classBy });
	} else {
		// The source names the rule that set the class: it is written with a
		// class this run sets, or kept current beside one a tool set before.
		// Finding nothing sets no class, so it records no rule.
		const settingClass = asset.origin_class !== proposal.originClass;
		propose("origin_class", proposal.originClass);
		if (settingClass || asset.origin_class_source !== "")
			propose("origin_class_source", proposal.source);
	}
	// Who signed the file is what the file says, not a person's choice of class.
	propose("signed_by", proposal.signedBy);
	propose("signer_name", proposal.signerName);

	const finalKind =
		out.changes.find((c) => c.field === "kind")?.to ?? asset.kind;
	if (
		finalKind === "generated" &&
		detected.platform !== "unknown" &&
		!db.prepare("SELECT 1 FROM generation WHERE asset_id = ?").get(assetId)
	)
		out.generation = generationFields(
			detected.platform,
			detected.data,
			exifTags ?? {},
		);
	return out;
}

export interface ClassifyReport {
	runId: number | null;
	examined: number;
	changed: number;
	generationAdded: number;
	assets: AssetClassification[];
}

/**
 * Classify every asset that is not removed. With dryRun, nothing is written
 * (not even a run); the report says what would change.
 */
export function classifyCatalog(
	db: DatabaseSync,
	opts: {
		tool: Tool;
		dryRun?: boolean;
		/** Only these assets (after a person's edit that their class follows). */
		assetIds?: readonly number[];
		now?: () => string;
	},
): ClassifyReport {
	const now = opts.now ?? (() => new Date().toISOString());
	const all = (
		db
			.prepare("SELECT id FROM assets WHERE removed_at IS NULL ORDER BY id")
			.all() as Array<{ id: number }>
	).map((r) => r.id);
	const ids = opts.assetIds
		? all.filter((id) => opts.assetIds!.includes(id))
		: all;
	const plans = ids
		.map((id) => classifyAsset(db, id))
		.filter((p): p is AssetClassification => p !== null);
	const report: ClassifyReport = {
		runId: null,
		examined: plans.length,
		changed: plans.filter((p) => p.changes.length || p.generation).length,
		generationAdded: plans.filter((p) => p.generation).length,
		assets: plans,
	};
	if (opts.dryRun) return report;

	const runId = startRun(db, { kind: "classify", tool: opts.tool, now: now() });
	report.runId = runId;
	const actor: Actor = {
		kind: "tool",
		name: `${opts.tool.name} ${opts.tool.version}`,
		runId,
	};
	try {
		inTransaction(db, () => {
			for (const p of plans) {
				const at = now();
				if (p.changes.length)
					editRow(
						db,
						"assets",
						p.assetId,
						Object.fromEntries(p.changes.map((c) => [c.field, c.to])),
						{ actor, evidence: p.evidence, now: at },
					);
				if (p.generation)
					createRow(
						db,
						"generation",
						{ asset_id: p.assetId, ...p.generation },
						{ actor, evidence: p.evidence, now: at },
					);
			}
			finishRun(db, runId, {
				outcome: "ok",
				summary: {
					examined: report.examined,
					changed: report.changed,
					generation_added: report.generationAdded,
				},
				now: now(),
			});
		});
	} catch (err) {
		finishRun(db, runId, {
			outcome: "failed",
			summary: { error: (err as Error).message },
			now: now(),
		});
		throw err;
	}
	return report;
}
