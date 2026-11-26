// Signing one source asset at ingest (D13, D42): its Content Credentials go
// in a .c2pa sidecar beside the file, named like the file without its
// extension, where C2PA readers look; the file itself is left as it is.
// Signing again first renames the earlier sidecar to <name>.v<N>.c2pa, and
// puts it back if signing fails. The same rules as the app's signOneAsset,
// read from and recorded in the catalog.

import { existsSync, renameSync, statSync } from "node:fs";
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
	buildAssetManifest,
	planSidecar,
} from "@provenancetracker/core/manifest/build.js";
import { sha256OfFile } from "../hash.ts";
import type { Machine } from "../machine.ts";
import type { OpenProject } from "../project.ts";
import { listRoots } from "../roots.ts";
import { TOOL } from "../tool.ts";
import { certificateInfoOf } from "./certificates.ts";
import type { CredentialHolder } from "./holders/index.ts";
import {
	storableDefinition,
	type SignIngredient,
	type SigningEngine,
} from "./engine.ts";
import { signingEngineFor } from "./engines/index.ts";
import {
	holderOrRefuse,
	identityFor,
	identityUrlOf,
	NotReadyError,
	refuseUnlessSetUp,
} from "./sign-output.ts";

const GENERATOR = { name: "provenance-tracker", version: TOOL.version };

export interface AssetSigningOptions {
	assetId: number;
	/** Who made it, and for whom; the project's author and organization when not given. */
	creatorName?: string;
	organization?: string;
	/** What made the file. */
	toolUsed?: string;
	/** The signer says a model made it; this wins over the class. */
	isAiGenerated?: boolean;
	/** Ask that it not be used to train or mine (the default). */
	trainingMiningOptOut?: boolean;
	engine?: SigningEngine;
	/** What holds the key; this machine's setup for the project when not given. */
	holder?: CredentialHolder;
	/** What holds the creator's identity key; this machine's setup for the project, if any, when not given. */
	identityHolder?: CredentialHolder;
	timestampUrl?: string;
	now?: () => string;
}

export interface SignedAsset {
	signatureId: number;
	runId: number;
	version: number;
	root: string;
	/** The sidecar's path in its root. */
	path: string;
	/** Where the earlier sidecar was moved to, when there was one. */
	archived: string | null;
	status: string;
}

/**
 * Sign an asset into a sidecar. Refuses (NotReadyError), writing nothing,
 * when signing is not set up here, its file is not on this machine or has
 * changed since its scan, the file carries credentials of its own, or a
 * .c2pa the tracker did not write is already beside it.
 */
export async function signAsset(
	project: OpenProject,
	machine: Machine,
	opts: AssetSigningOptions,
): Promise<SignedAsset> {
	const { db } = project;
	const now = opts.now ?? (() => new Date().toISOString());
	const asset = db
		.prepare("SELECT * FROM assets WHERE id = ?")
		.get(opts.assetId) as Record<string, unknown> | undefined;
	if (!asset) throw new NotReadyError("There is no such asset");
	if (!opts.holder) refuseUnlessSetUp(machine, project.projectId);

	// The asset's own newest file, and a live place of it on this machine.
	const roots = new Map(
		listRoots(project, machine)
			.filter((r) => r.status === "ok" && r.folder)
			.map((r) => [r.id, r]),
	);
	const own = db
		.prepare(
			`SELECT c.sha256, l.root_id, l.path FROM contents c
			 JOIN locations l ON l.content_sha256 = c.sha256 AND l.gone_run_id IS NULL
			 WHERE c.asset_id = ? AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)
			 ORDER BY c.created_at DESC, c.rowid DESC, l.id`,
		)
		.all(opts.assetId) as Array<{
		sha256: string;
		root_id: number;
		path: string;
	}>;
	const place = own.find(
		(p) =>
			roots.has(p.root_id) &&
			existsSync(
				fromCatalogPath(
					roots.get(p.root_id)!.folder!,
					p.path,
					machine.platform,
				),
			),
	);
	if (!place)
		throw new NotReadyError(
			"The asset's file is not on this machine. Scan its root, or locate it.",
		);
	const root = roots.get(place.root_id)!;
	const file = fromCatalogPath(root.folder!, place.path, machine.platform);
	if ((await sha256OfFile(file)) !== place.sha256)
		throw new NotReadyError(
			"The file has changed since it was scanned. Scan its root, then sign.",
		);

	const engine = opts.engine ?? (await signingEngineFor(machine));
	const embedded = await engine.readEmbedded(file);
	if (embedded)
		throw new NotReadyError(
			`This file already carries its own Content Credentials${embedded.signer ? ` (signed by ${embedded.signer})` : ""}. It does not need signing at ingest, and a sidecar could not match it without stripping them. They are carried into any output you sign.`,
		);

	// The sidecar beside it: written fresh, or the earlier one this tracker wrote moved aside.
	const sidecarFile = `${file.slice(0, file.length - path.extname(file).length)}.c2pa`;
	const relOf = (p: string) => {
		const rel = toCatalogPath(root.folder!, p, machine.platform);
		if (!rel) throw new Error(`${p} is not inside its root`);
		return rel;
	};
	const current = existsSync(sidecarFile)
		? (db
				.prepare(
					`SELECT s.id, s.version, s.signed_sha256 FROM signatures s
					 JOIN locations l ON l.content_sha256 = s.signed_sha256 AND l.gone_run_id IS NULL
					 WHERE s.asset_id = ? AND s.kind = 'asset' AND l.root_id = ? AND l.path = ?`,
				)
				.get(opts.assetId, root.id, relOf(sidecarFile)) as
				{ id: number; version: number; signed_sha256: string } | undefined)
		: undefined;
	const plan = planSidecar({
		inputPath: file,
		sidecarExists: existsSync(sidecarFile),
		currentSignature: current ?? null,
		latestVersion: nextSignatureVersion(db, opts.assetId, "asset") - 1,
	}) as
		| { action: "write"; version: number; sidecarPath: string }
		| {
				action: "rotate";
				version: number;
				sidecarPath: string;
				archive: { from: string; to: string };
		  }
		| { action: "refuse"; reason: string };
	if (plan.action === "refuse") throw new NotReadyError(plan.reason);
	// The catalog says the .c2pa beside the file is one the tracker wrote, and
	// it is about to be renamed on that word. Its bytes must be the ones the
	// catalog recorded: a catalog from someone else could claim any file (D68).
	if (
		plan.action === "rotate" &&
		(await sha256OfFile(plan.archive.from)) !== current!.signed_sha256
	)
		throw new NotReadyError(
			`${path.basename(plan.archive.from)} beside this file is not the sidecar the tracker wrote: it has changed since. Move or rename it, then sign again.`,
		);
	if (plan.action === "rotate" && existsSync(plan.archive.to))
		throw new NotReadyError(
			`Cannot set the earlier signature aside: ${path.basename(plan.archive.to)} already exists.`,
		);

	const meta = (key: string) =>
		(
			db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
				{ value: string } | undefined
		)?.value ?? "";
	// The builder refuses an asset whose class is not known yet: a manifest
	// has to say how the file was made.
	let built: { definition: unknown; ingredients: unknown };
	try {
		built = buildAssetManifest({
			title: path.basename(file),
			originClass: String(asset.origin_class ?? "unknown"),
			isAiGenerated: !!opts.isAiGenerated,
			toolUsed: opts.toolUsed ?? "",
			authorName: opts.creatorName ?? meta("author"),
			organization: opts.organization ?? meta("organization"),
			identityUrl: identityUrlOf(project),
			trainingMiningOptOut: opts.trainingMiningOptOut !== false,
			generator: GENERATOR,
		});
	} catch (err) {
		throw new NotReadyError((err as Error).message);
	}
	const { definition, ingredients } = built;

	// The keys are opened for this signing only, and let go with the holders.
	const identity = await identityFor(
		machine,
		project.projectId,
		engine,
		definition as Record<string, unknown>,
		opts.identityHolder,
	);
	const holder =
		opts.holder ?? (await holderOrRefuse(machine, project.projectId));
	if (plan.action === "rotate") renameSync(plan.archive.from, plan.archive.to);
	let report: Record<string, unknown> | null;
	try {
		({ report } = await engine.sign({
			inputPath: file,
			outputPath: plan.sidecarPath,
			definition: definition as Record<string, unknown>,
			ingredients: ingredients as SignIngredient[],
			holder,
			identity,
			timestampUrl: opts.timestampUrl,
			sidecar: true,
		}));
	} catch (err) {
		// Put the earlier signature back where readers look for it.
		if (plan.action === "rotate" && !existsSync(plan.archive.from))
			renameSync(plan.archive.to, plan.archive.from);
		throw err;
	}

	const stats = statSync(plan.sidecarPath);
	const signedSha256 = await sha256OfFile(plan.sidecarPath);
	// The new sidecar as `extract` reads one, kept below as a reading: signing
	// an edit that places this source compares what the sidecar says with what
	// the review showed (D63), and this is what the review shows.
	const reading = await engine.read(file, plan.sidecarPath);
	const { signatureId, runId } = recordSigning(
		db,
		{
			assetId: opts.assetId,
			kind: "asset",
			version: plan.version,
			sourceSha256: place.sha256,
			signed: {
				sha256: signedSha256,
				size: stats.size,
				rootId: root.id,
				path: relOf(plan.sidecarPath),
				modifiedMs: Math.floor(stats.mtimeMs),
			},
			engine: engine.name,
			engineVersion: engine.version,
			certificateSha256: certificateInfoOf(holder.chain).fingerprint,
			definition: storableDefinition(definition as Record<string, unknown>),
			statementId: null,
			statement: null,
			report,
			signedAt: now(),
			moved:
				plan.action === "rotate" && current
					? {
							sha256: current.signed_sha256,
							rootId: root.id,
							from: relOf(plan.archive.from),
							to: relOf(plan.archive.to),
							modifiedMs: Math.floor(statSync(plan.archive.to).mtimeMs),
						}
					: undefined,
		},
		{ tool: TOOL, now },
	);
	if (reading.status !== "unavailable")
		db.prepare(
			`INSERT INTO observations (content_sha256, source_sha256, run_id, kind, extractor, extractor_version,
			   status, data, error, warnings, validation, observed_at)
			 VALUES (?, ?, ?, 'c2pa-sidecar', ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			place.sha256,
			signedSha256,
			runId,
			reading.extractor,
			reading.version,
			reading.status,
			reading.data === null ? null : JSON.stringify(reading.data),
			reading.error,
			JSON.stringify(reading.warnings),
			reading.validation ? JSON.stringify(reading.validation) : null,
			now(),
		);
	const { status } = db
		.prepare("SELECT status FROM signatures WHERE id = ?")
		.get(signatureId) as { status: string };
	return {
		signatureId,
		runId,
		version: plan.version,
		root: root.name,
		path: relOf(plan.sidecarPath),
		archived: plan.action === "rotate" ? relOf(plan.archive.to) : null,
		status,
	};
}
