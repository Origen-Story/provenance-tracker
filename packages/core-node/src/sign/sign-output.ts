// Signing a finished edit from its catalog (D41): its newest timeline and
// saved statement build the manifest (core's build.js, unchanged), c2patool
// signs a new versioned copy beside the cut, and the copy and the signing are
// recorded. The same steps as the app's signOutput, read from the catalog.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
	nextSignatureVersion,
	recordSigning,
} from "@provenancetracker/core/catalog/signatures.ts";
import {
	fromCatalogPath,
	toCatalogPath,
} from "@provenancetracker/core/catalog/paths.ts";
import {
	refreshTimeline,
	timelineSegments,
} from "@provenancetracker/core/catalog/timelines.ts";
import { c2paSummaryOf } from "@provenancetracker/core/extraction/c2pa-summary.ts";
import { buildOutputManifest } from "@provenancetracker/core/manifest/build.js";
import { c2patoolPath, c2patoolVersion } from "../extract/c2patool.ts";
import { sha256OfFile } from "../hash.ts";
import type { Machine } from "../machine.ts";
import type { OpenProject } from "../project.ts";
import { listRoots } from "../roots.ts";
import { TOOL } from "../tool.ts";
import {
	certificateInfo,
	signWithC2patool,
	storableDefinition,
	type SignIngredient,
} from "./c2patool-sign.ts";
import { signerPaths } from "./signing-settings.ts";

/** What signs: c2patool by default; tests give a stand-in. */
export interface SigningEngine {
	name: string;
	version: string;
	sign: (args: {
		inputPath: string;
		outputPath: string;
		definition: Record<string, unknown>;
		ingredients: SignIngredient[];
		certificatePath: string;
		privateKeyPath: string;
		timestampUrl?: string;
	}) => Promise<{ report: Record<string, unknown> | null }>;
}

/** c2patool on this machine, as the engine. */
export async function c2patoolEngine(machine: Machine): Promise<SigningEngine> {
	const tool = c2patoolPath(machine.env, machine.platform);
	return {
		name: "c2patool",
		version: (await c2patoolVersion(tool)) ?? "",
		sign: (args) => signWithC2patool({ ...args, tool }),
	};
}

/** What signs the file says it was made by: this tracker, under its public name. */
const GENERATOR = { name: "provenance-tracker", version: TOOL.version };

/** A refusal before anything is signed: the caller's to fix (HTTP 400). */
export class NotReadyError extends Error {}

type Row = Record<string, unknown>;

/** Every live place of each content on this machine: sha256 → [{ rootId, path, file }]. */
function placesHere(project: OpenProject, machine: Machine) {
	const folders = new Map(
		listRoots(project, machine)
			.filter((r) => r.status === "ok" && r.folder)
			.map((r) => [r.id, r.folder!]),
	);
	const out = new Map<
		string,
		Array<{ rootId: number; rootFolder: string; path: string; file: string }>
	>();
	for (const l of project.db
		.prepare(
			"SELECT content_sha256 AS sha, root_id, path FROM locations WHERE gone_run_id IS NULL ORDER BY id",
		)
		.all() as Array<{ sha: string; root_id: number; path: string }>) {
		const folder = folders.get(l.root_id);
		if (!folder) continue;
		const file = fromCatalogPath(folder, l.path, machine.platform);
		if (!existsSync(file)) continue;
		const list = out.get(l.sha) ?? [];
		list.push({ rootId: l.root_id, rootFolder: folder, path: l.path, file });
		out.set(l.sha, list);
	}
	return out;
}

/** An asset's own newest file (never a signed copy). */
function ownContent(project: OpenProject, assetId: number): string | null {
	const row = project.db
		.prepare(
			`SELECT c.sha256 FROM contents c WHERE c.asset_id = ?
			   AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)
			 ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`,
		)
		.get(assetId) as { sha256: string } | undefined;
	return row?.sha256 ?? null;
}

/** The newest c2pa reading of a content, as the statement's "credentials in the file" reads it. */
function c2paOf(project: OpenProject, sha256: string) {
	const row = project.db
		.prepare(
			`SELECT status, data, error, validation FROM observations
			 WHERE content_sha256 = ? AND kind IN ('c2pa', 'c2pa-sidecar') ORDER BY id DESC LIMIT 1`,
		)
		.get(sha256) as Row | undefined;
	if (!row) return null;
	const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : null);
	return c2paSummaryOf({
		status: row.status as "ok",
		data: parse(row.data),
		error: (row.error as string | null) ?? null,
		validation: parse(row.validation),
	});
}

/** The signed copy's name: the cut's, with ".signed.v<N>" before the extension; the first free N from `version`. */
function signedName(
	cutFile: string,
	version: number,
): { file: string; version: number } {
	const ext = path.extname(cutFile);
	const stem = cutFile.slice(0, cutFile.length - ext.length);
	for (let v = version; v < version + 1000; v++) {
		const file = `${stem}.signed.v${v}${ext}`;
		if (!existsSync(file)) return { file, version: v };
	}
	throw new Error("No free name for the signed copy");
}

export interface SignedOutput {
	signatureId: number;
	runId: number;
	version: number;
	/** Where the signed copy is: its root and path. */
	root: string;
	path: string;
	status: string;
}

/**
 * Sign an output. Refuses (NotReadyError) when there is no signing set up
 * here, no saved statement, no timeline, or a file it needs is not on this
 * machine; nothing is written then.
 */
export async function signOutput(
	project: OpenProject,
	machine: Machine,
	opts: {
		assetId: number;
		engine?: SigningEngine;
		timestampUrl?: string;
		now?: () => string;
	},
): Promise<SignedOutput> {
	const { db } = project;
	const now = opts.now ?? (() => new Date().toISOString());
	const asset = db
		.prepare("SELECT * FROM assets WHERE id = ?")
		.get(opts.assetId) as Row | undefined;
	if (!asset) throw new NotReadyError("There is no such asset");
	let signer;
	try {
		signer = signerPaths(machine, project.projectId);
	} catch (err) {
		throw new NotReadyError((err as Error).message);
	}

	const cut = ownContent(project, opts.assetId);
	const places = placesHere(project, machine);
	const cutPlace = cut ? places.get(cut)?.[0] : undefined;
	if (!cut || !cutPlace)
		throw new NotReadyError(
			"The output's file is not on this machine. Scan its root, or locate it.",
		);
	const timeline = db
		.prepare(
			"SELECT id, sequence_name, fps, duration_frames FROM timelines WHERE content_sha256 = ? ORDER BY id DESC LIMIT 1",
		)
		.get(cut) as Row | undefined;
	if (!timeline)
		throw new NotReadyError(
			"Import the timeline first: the statement is built from it.",
		);
	const statement = db
		.prepare(
			"SELECT id, text, author, organization, edited_with FROM statements WHERE asset_id = ? ORDER BY id DESC LIMIT 1",
		)
		.get(opts.assetId) as Row | undefined;
	if (!statement || !String(statement.text ?? "").trim())
		throw new NotReadyError(
			"Write and save the creator statement before signing.",
		);

	const breakdown = refreshTimeline(db, timeline.id as number) as {
		composition?: unknown;
	};
	const segments = timelineSegments(db, timeline.id as number, {
		refOf: (id) => String(id),
		segmentIdOf: (id) => id,
	});
	const outputRef = String(opts.assetId);
	const assets = new Map<string, Row>();
	const missing: string[] = [];
	for (const ref of new Set(
		segments
			.filter(
				(s) =>
					s.enabled && s.matchedAssetRef && s.matchedAssetRef !== outputRef,
			)
			.map((s) => s.matchedAssetRef!),
	)) {
		const a = db
			.prepare("SELECT * FROM assets WHERE id = ?")
			.get(Number(ref)) as Row;
		const sha = ownContent(project, Number(ref));
		const place = sha ? places.get(sha)?.[0] : undefined;
		if (!place) {
			missing.push(a.title ? String(a.title) : `asset ${ref}`);
			continue;
		}
		assets.set(ref, {
			filePath: place.file,
			publicTitle: a.public_title,
			originClass: a.origin_class,
			originClassConfirmed: a.origin_class_confirmed === 1,
			originClassSource: a.origin_class_source,
			originClassNote: a.origin_class_note,
			aiAssisted: a.ai_assisted === 1,
			signedBy: a.signed_by,
			signerName: a.signer_name,
			c2paSummary: c2paOf(project, sha!),
		});
	}
	if (missing.length)
		throw new NotReadyError(
			`These files the timeline places are not on this machine, and c2patool reads each one: ${missing.join(", ")}`,
		);

	const identityUrl =
		(
			db
				.prepare("SELECT value FROM meta WHERE key = 'cawg_identity_url'")
				.get() as { value: string } | undefined
		)?.value ?? "";
	const {
		definition,
		ingredients,
		statement: signedStatement,
	} = buildOutputManifest({
		output: {
			ref: outputRef,
			filePath: cutPlace.file,
			originClass: asset.origin_class,
			originClassConfirmed: asset.origin_class_confirmed === 1,
			publicTitle: asset.public_title,
		},
		timeline: {
			sequenceName: timeline.sequence_name,
			fps: timeline.fps,
			durationFrames: timeline.duration_frames,
		},
		composition: breakdown.composition,
		segments,
		assets,
		statement: {
			text: statement.text,
			authorName: statement.author,
			organization: statement.organization,
			softwareAgent: statement.edited_with,
			identityUrl,
		},
		statedAt: now(),
		generator: GENERATOR,
	});

	// The file signed must be the bytes the catalog knows as the cut.
	if ((await sha256OfFile(cutPlace.file)) !== cut)
		throw new NotReadyError(
			"The output's file has changed since it was scanned. Scan its root, then sign.",
		);
	const { file: outputPath, version } = signedName(
		cutPlace.file,
		nextSignatureVersion(db, opts.assetId, "output"),
	);
	const engine = opts.engine ?? (await c2patoolEngine(machine));
	const { report } = await engine.sign({
		inputPath: cutPlace.file,
		outputPath,
		definition: definition as Record<string, unknown>,
		ingredients: ingredients as SignIngredient[],
		certificatePath: signer.certificatePath,
		privateKeyPath: signer.privateKeyPath,
		timestampUrl: opts.timestampUrl,
	});
	const rel = toCatalogPath(cutPlace.rootFolder, outputPath, machine.platform);
	if (!rel) throw new Error(`${outputPath} is not inside its root`);
	const stats = statSync(outputPath);
	const { signatureId, runId } = recordSigning(
		db,
		{
			assetId: opts.assetId,
			kind: "output",
			version,
			sourceSha256: cut,
			signed: {
				sha256: await sha256OfFile(outputPath),
				size: stats.size,
				rootId: cutPlace.rootId,
				path: rel,
				modifiedMs: Math.floor(stats.mtimeMs),
			},
			engine: engine.name,
			engineVersion: engine.version,
			certificateSha256: (await certificateInfo(signer.certificatePath))
				.fingerprint,
			definition: storableDefinition(definition as Record<string, unknown>),
			statementId: statement.id as number,
			statement: signedStatement,
			report,
			signedAt: now(),
		},
		{ tool: TOOL, now },
	);
	const root = listRoots(project, machine).find(
		(r) => r.id === cutPlace.rootId,
	)!.name;
	const { status } = db
		.prepare("SELECT status FROM signatures WHERE id = ?")
		.get(signatureId) as { status: string };
	return { signatureId, runId, version, root, path: rel, status };
}
