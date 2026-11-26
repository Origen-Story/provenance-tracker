// Signings in the catalog (roadmap Phase 6, D41): recording one, and what is
// made from the record alone (the public export). Pure: SQL on a catalog it is
// handed; signing itself (c2patool, the key) is core-node's.
//
// A signed copy is a new content of the asset it signs, with its own place
// beside the file signed; the asset keeps its own file as its current one, so
// a timeline that uses the original still matches it. A signing never changes.

import type { DatabaseSync } from "node:sqlite";
import { interpretReport } from "../manifest/verify.js";
import {
	buildPublicExport,
	publicExportFileName,
} from "../manifest/public-export.js";
import type { Tool } from "./create.ts";
import { createRow, type Actor } from "./edit.ts";
import { EditError, NotFoundError } from "./errors.ts";
import { inTransaction } from "./format.ts";
import { finishRun, startRun } from "./runs.ts";
import { publicationOf } from "./publications.ts";

/** The version the next signing of this kind of this asset gets: one more than the last. */
export function nextSignatureVersion(
	db: DatabaseSync,
	assetId: number,
	kind: "asset" | "output",
): number {
	const row = db
		.prepare(
			"SELECT max(version) AS v FROM signatures WHERE asset_id = ? AND kind = ?",
		)
		.get(assetId, kind) as { v: number | null };
	return (row.v ?? 0) + 1;
}

export interface NewSigning {
	assetId: number;
	kind: "asset" | "output";
	version: number;
	/** The content signed: the asset's own file. */
	sourceSha256: string;
	/** The signed copy, and where it was written. */
	signed: {
		sha256: string;
		size: number;
		rootId: number;
		path: string;
		modifiedMs: number;
	};
	engine: string;
	engineVersion: string;
	/** The signing certificate's SHA-256 fingerprint; never a path. */
	certificateSha256: string;
	/** The manifest definition as signed, without the signer's fields. */
	definition: Record<string, unknown>;
	/** The saved statement this signing used, and the statement as signed. */
	statementId: number | null;
	statement: unknown;
	/** c2patool's read-back of the signed copy. */
	report: unknown;
	signedAt: string;
	/**
	 * A file this signing moved: re-signing an asset renames its earlier
	 * sidecar to <name>.v<N>.c2pa first. Recorded here, in the same
	 * transaction, so the catalog never disagrees with the folder.
	 */
	moved?: {
		sha256: string;
		rootId: number;
		from: string;
		to: string;
		modifiedMs: number;
	};
}

/**
 * Record a signing under one sign run: the signed copy as a content of the
 * asset with its place, and the signing itself. Signer and status come from
 * the read-back report, as the app recorded them.
 * @returns the signing's id and the run's
 */
export function recordSigning(
	db: DatabaseSync,
	input: NewSigning,
	opts: { tool: Tool; now?: () => string },
): { signatureId: number; runId: number } {
	const now = opts.now ?? (() => new Date().toISOString());
	const source = db
		.prepare("SELECT asset_id FROM contents WHERE sha256 = ?")
		.get(input.sourceSha256) as { asset_id: number } | undefined;
	if (!source || source.asset_id !== input.assetId)
		throw new EditError("The file signed is not this asset's");
	const runId = startRun(db, { kind: "sign", tool: opts.tool, now: now() });
	const actor: Actor = {
		kind: "tool",
		name: `${opts.tool.name} ${opts.tool.version}`,
		runId,
	};
	try {
		const signatureId = inTransaction(db, () => {
			const at = now();
			const owner = db
				.prepare("SELECT asset_id FROM contents WHERE sha256 = ?")
				.get(input.signed.sha256) as { asset_id: number } | undefined;
			if (owner && owner.asset_id !== input.assetId)
				throw new EditError(
					"The signed copy has the same bytes as another asset's file",
				);
			if (!owner)
				createRow(
					db,
					"contents",
					{
						sha256: input.signed.sha256,
						size: input.signed.size,
						asset_id: input.assetId,
						first_run_id: runId,
						created_at: at,
					},
					{
						actor,
						now: at,
						evidence: {
							signed_from: input.sourceSha256,
							version: input.version,
						},
					},
				);
			const place = db.prepare(
				`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			);
			if (input.moved) {
				const gone = db
					.prepare(
						"UPDATE locations SET gone_run_id = ? WHERE content_sha256 = ? AND root_id = ? AND path = ? AND gone_run_id IS NULL",
					)
					.run(runId, input.moved.sha256, input.moved.rootId, input.moved.from);
				if (gone.changes !== 1)
					throw new EditError(
						`The catalog does not have ${input.moved.from} where the file moved from`,
					);
				place.run(
					input.moved.sha256,
					input.moved.rootId,
					input.moved.to,
					input.moved.modifiedMs,
					runId,
					runId,
				);
			}
			place.run(
				input.signed.sha256,
				input.signed.rootId,
				input.signed.path,
				input.signed.modifiedMs,
				runId,
				runId,
			);
			const v = interpretReport((input.report ?? null) as object | null) as {
				status: string;
				signer: { commonName?: string; issuer?: string } | null;
				timestamped: boolean;
			};
			const id = Number(
				db
					.prepare(
						`INSERT INTO signatures (asset_id, kind, version, source_sha256, signed_sha256, run_id, engine,
						   engine_version, certificate_sha256, signer_name, signer_issuer, timestamped, definition,
						   statement_id, statement, report, status, signed_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						input.assetId,
						input.kind,
						input.version,
						input.sourceSha256,
						input.signed.sha256,
						runId,
						input.engine,
						input.engineVersion,
						input.certificateSha256,
						v.signer?.commonName ?? "",
						v.signer?.issuer ?? "",
						v.timestamped ? 1 : 0,
						JSON.stringify(input.definition),
						input.statementId,
						input.statement === null || input.statement === undefined
							? null
							: JSON.stringify(input.statement),
						input.report === null || input.report === undefined
							? null
							: JSON.stringify(input.report),
						v.status,
						input.signedAt,
					).lastInsertRowid,
			);
			finishRun(db, runId, {
				outcome: "ok",
				summary: {
					signature: id,
					asset: input.assetId,
					kind: input.kind,
					version: input.version,
					status: v.status,
				},
				now: now(),
			});
			return id;
		});
		return { signatureId, runId };
	} catch (err) {
		const run = db
			.prepare("SELECT finished_at FROM runs WHERE id = ?")
			.get(runId) as { finished_at: string | null };
		if (run.finished_at === null)
			finishRun(db, runId, {
				outcome: "failed",
				summary: { error: (err as Error).message },
				now: now(),
			});
		throw err;
	}
}

/**
 * A signing as buildPublicExport reads it (the app's signatures row): the
 * statement and report as signed, and the signed copy's file name, hash,
 * size, version and time, from the catalog, and the definition as stored.
 */
export function signatureForExport(db: DatabaseSync, signatureId: number) {
	const s = db
		.prepare(
			`SELECT s.kind, s.version, s.statement, s.report, s.definition, s.signed_sha256, s.signed_at, s.certificate_sha256, c.size,
			        (SELECT l.path FROM locations l WHERE l.content_sha256 = s.signed_sha256
			         ORDER BY l.gone_run_id IS NOT NULL, l.id LIMIT 1) AS path
			 FROM signatures s JOIN contents c ON c.sha256 = s.signed_sha256 WHERE s.id = ?`,
		)
		.get(signatureId) as
		| {
				kind: string;
				version: number;
				statement: string | null;
				report: string | null;
				definition: string;
				signed_sha256: string;
				signed_at: string;
				certificate_sha256: string;
				size: number;
				path: string | null;
		  }
		| undefined;
	if (!s) throw new NotFoundError("There is no such signing");
	return {
		kind: s.kind,
		version: s.version,
		statementJson: s.statement,
		reportJson: s.report,
		definitionJson: s.definition,
		signedPath: s.path ?? "",
		signedHash: s.signed_sha256,
		signedSize: s.size,
		createdAt: s.signed_at,
		// The signing certificate's SHA-256, kept at signing; "" for a
		// signing recorded before it was (D72).
		certificateSha256: s.certificate_sha256,
	};
}

/**
 * The public export (the record a public page shows) of one signing of an
 * output, built from that signing's record alone, and the name to save it as.
 */
export function publicExport(
	db: DatabaseSync,
	signatureId: number,
	opts: { generatedAt: string; generator: { name: string; version: string } },
): { data: unknown; fileName: string } {
	const signature = signatureForExport(db, signatureId);
	if (signature.kind !== "output")
		throw new EditError("Only a signed output has a public export");
	// Where it is published (D56), so the record links the signed file and its page.
	const publication = publicationOf(db, signatureId);
	let data: unknown;
	try {
		data = buildPublicExport({ signature, publication, ...opts });
	} catch (err) {
		throw new EditError((err as Error).message);
	}
	return { data, fileName: publicExportFileName(signature.signedPath) };
}
