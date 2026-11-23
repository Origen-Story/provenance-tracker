// Write a migration plan (plan.ts) into a new catalog. Pure: the caller
// finds each file, hashes it, and says which root and path it is at; this
// runs the SQL, in one transaction, under one migrate run.
//
// Every editable value is written through edit.ts as a legacy change, at
// the time Postgres last changed it, with the Postgres table and id as
// evidence: the catalog can say where each value came from, and never
// claims a person or this tracker chose it.

import type { DatabaseSync } from "node:sqlite";
import type { Tool } from "../catalog/create.ts";
import { createRow, setMeta, type Actor } from "../catalog/edit.ts";
import { inTransaction } from "../catalog/format.ts";
import { finishRun, startRun } from "../catalog/runs.ts";
import type { LegacyRef, MigrationPlan, PlannedFile } from "./plan.ts";

/** How history names the values carried from Postgres. */
export const LEGACY_ACTOR_NAME = "provenance-tracker app (Postgres)";

/** What the extractor of a legacy observation is called. */
export const LEGACY_EXTRACTOR = "provenance-tracker app";

/** The engine every Postgres signing used (src/server/lib/manifest/c2patool.js). */
export const LEGACY_SIGNING_ENGINE = "c2patool";

/** A file as the caller found it. */
export type FileFact =
	| {
			found: true;
			rootId: number;
			/** The catalog path in that root ('/' between folders). */
			path: string;
			sha256: string;
			size: number;
			modifiedMs: number;
	  }
	| { found: false; reason: string };

export interface MigrationSource {
	/** The dump's file name and its SHA-256, kept in meta migrated_from. */
	dumpFile: string;
	dumpSha256: string;
}

export interface MigrationResult {
	runId: number;
	/** Catalog asset id by Postgres ref. */
	assetIds: Map<LegacyRef, number>;
	counts: Record<string, number>;
	/** Files Postgres names that were not found, carried as contents without a place. */
	notFound: Array<{ path: string; reason: string }>;
	/**
	 * The Postgres row behind each catalog row ("public.produced_assets:33"),
	 * by table and catalog id. Also kept in the migrate run's summary, so it
	 * stays in the catalog for rows that have no history (statements,
	 * signings, a timeline whose settings are all defaults).
	 */
	origins: Record<string, Record<string, string>>;
}

/**
 * Check what was found against what Postgres says: a file whose bytes are
 * not the ones Postgres recorded, or that is missing with no hash to carry.
 * Each is a reason not to write.
 */
export function fileProblems(
	plan: MigrationPlan,
	facts: (path: string) => FileFact,
): string[] {
	const out: string[] = [];
	const check = (what: string, file: PlannedFile, needed: boolean) => {
		const fact = facts(file.path);
		if (!fact.found) {
			if (needed && (!file.sha256 || file.size === null))
				out.push(
					`${what}: ${file.path} is not there (${fact.reason}), and Postgres has no hash and size to carry`,
				);
			return;
		}
		if (file.sha256 && fact.sha256 !== file.sha256)
			out.push(
				`${what}: ${file.path} holds other bytes than Postgres recorded (${fact.sha256.slice(0, 12)}…, Postgres ${file.sha256.slice(0, 12)}…)`,
			);
		else if (file.size !== null && fact.size !== file.size)
			out.push(
				`${what}: ${file.path} is ${fact.size} bytes; Postgres recorded ${file.size}`,
			);
	};
	for (const a of plan.assets) check(a.ref, a.file, true);
	const assetSha = (ref: LegacyRef): string | null => {
		const file = plan.assets.find((a) => a.ref === ref)?.file;
		if (!file) return null;
		const fact = facts(file.path);
		return fact.found ? fact.sha256 : file.sha256;
	};
	for (const s of plan.signatures) {
		check(`signature ${s.legacyId} source`, s.source, false);
		// A source that is not there is carried as the asset's own file, which
		// is right only if Postgres recorded those bytes as the source.
		if (
			!facts(s.source.path).found &&
			s.source.sha256 &&
			s.source.sha256 !== assetSha(s.asset)
		)
			out.push(
				`signature ${s.legacyId} source: ${s.source.path} is not there, and the bytes Postgres recorded as signed (${s.source.sha256.slice(0, 12)}…) are not the asset's file`,
			);
		check(`signature ${s.legacyId} signed copy`, s.signed, true);
	}
	return out;
}

/**
 * Write the plan into a catalog that has just been created (createCatalog)
 * and has its roots. Refuses a plan with blocking problems or a file that
 * fails fileProblems; writes nothing in that case.
 */
export function writeMigration(
	db: DatabaseSync,
	plan: MigrationPlan,
	opts: {
		facts: (path: string) => FileFact;
		/** The timeline files' SHA-256s that are in place under timelines/. */
		timelineFiles: (sha256: string) => boolean;
		source: MigrationSource;
		tool: Tool;
		now?: () => string;
	},
): MigrationResult {
	if (plan.blocking.length)
		throw new Error(
			`The plan has problems to settle first:\n- ${plan.blocking.join("\n- ")}`,
		);
	const problems = fileProblems(plan, opts.facts);
	for (const t of plan.timelines)
		if (t.file.sha256 && !opts.timelineFiles(t.file.sha256))
			problems.push(
				`timeline ${t.evidence.id}: its file ${t.file.sha256.slice(0, 12)}… is not in the project's timelines folder`,
			);
	if (problems.length)
		throw new Error(`Files to settle first:\n- ${problems.join("\n- ")}`);
	const existing = db.prepare("SELECT count(*) AS n FROM assets").get() as {
		n: number;
	};
	if (existing.n > 0)
		throw new Error("A migration writes into a new catalog with no assets");

	const now = opts.now ?? (() => new Date().toISOString());
	const runId = startRun(db, { kind: "migrate", tool: opts.tool, now: now() });
	const actor: Actor = { kind: "legacy", name: LEGACY_ACTOR_NAME, runId };
	const counts: Record<string, number> = {};
	const count = (k: string, n = 1) => {
		counts[k] = (counts[k] ?? 0) + n;
	};
	const assetIds = new Map<LegacyRef, number>();
	const notFound: MigrationResult["notFound"] = [];
	const origins: MigrationResult["origins"] = {};
	const from = (
		table: string,
		id: number | bigint,
		e: { legacy: string; id: number },
	) => {
		(origins[table] ??= {})[String(id)] = `${e.legacy}:${e.id}`;
	};
	const idOf = (ref: LegacyRef) => {
		const id = assetIds.get(ref);
		if (id === undefined) throw new Error(`No catalog asset for ${ref}`);
		return id;
	};

	try {
		inTransaction(db, () => {
			const p = plan.project;
			const at = p.updatedAt;
			for (const [key, value] of [
				["name", p.name],
				["description", p.description],
				["code_prefix", p.codePrefix],
				["cawg_identity_url", p.cawgIdentityUrl],
				["cawg_identity_name", p.cawgIdentityName],
			] as const)
				if (value)
					setMeta(db, key, value, {
						actor,
						now: at,
						evidence: { legacy: "public.projects", id: p.legacyId },
					});
			db.prepare(
				"INSERT INTO meta (key, value) VALUES ('migrated_from', ?)",
			).run(
				JSON.stringify({
					system: "postgres",
					project_id: p.legacyId,
					created_at: p.createdAt,
					updated_at: p.updatedAt,
					schema_migrations: plan.schemaMigrations,
					dump_file: opts.source.dumpFile,
					dump_sha256: opts.source.dumpSha256,
				}),
			);

			const contentAsset = db.prepare(
				"SELECT asset_id FROM contents WHERE sha256 = ?",
			);
			const livePath = new Set<string>();
			const insertLocation = db.prepare(
				`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			);
			/** The content for a file, created if new; and its place, if found. */
			const place = (file: PlannedFile, assetId: number, createdAt: string) => {
				const fact = opts.facts(file.path);
				const sha = fact.found ? fact.sha256 : file.sha256;
				const size = fact.found ? fact.size : file.size;
				if (!sha || size === null) return null;
				const owner = contentAsset.get(sha) as { asset_id: number } | undefined;
				if (owner && owner.asset_id !== assetId)
					throw new Error(
						`${file.path} has the same bytes as another asset's file (catalog asset ${owner.asset_id}); one content belongs to one asset`,
					);
				if (!owner) {
					createRow(
						db,
						"contents",
						{
							sha256: sha,
							size,
							asset_id: assetId,
							first_run_id: runId,
							created_at: createdAt,
						},
						{ actor, now: createdAt },
					);
					count("contents");
				}
				if (fact.found) {
					const key = `${fact.rootId}\u0000${fact.path}`;
					if (!livePath.has(key)) {
						livePath.add(key);
						insertLocation.run(
							sha,
							fact.rootId,
							fact.path,
							fact.modifiedMs,
							runId,
							runId,
						);
						count("locations");
					}
				} else if (!notFound.some((n) => n.path === file.path))
					notFound.push({ path: file.path, reason: fact.reason });
				return sha;
			};

			const contentOf = new Map<LegacyRef, string>();
			for (const a of plan.assets) {
				const id = Number(
					createRow(
						db,
						"assets",
						{ ...a.fields, created_at: a.createdAt },
						{ actor, now: a.updatedAt, evidence: a.evidence },
					),
				);
				assetIds.set(a.ref, id);
				from("assets", id, a.evidence);
				count("assets");
				const sha = place(a.file, id, a.createdAt)!;
				contentOf.set(a.ref, sha);
				a.credits.forEach((c, i) => {
					createRow(
						db,
						"credits",
						{
							asset_id: id,
							role: c.role,
							name: c.name,
							stated_by: "legacy import",
							sort_order: i,
							created_at: a.createdAt,
						},
						{ actor, now: a.updatedAt, evidence: a.evidence },
					);
					count("credits");
				});
				if (a.generation) {
					createRow(
						db,
						"generation",
						{ asset_id: id, ...a.generation.fields },
						{ actor, now: a.generation.at, evidence: a.generation.evidence },
					);
					count("generation");
				}
				const observe = db.prepare(
					`INSERT INTO observations (content_sha256, run_id, kind, extractor, extractor_version, status, data, observed_at)
					 VALUES (?, ?, ?, ?, 'unknown', 'ok', ?, ?)`,
				);
				for (const o of a.observations) {
					observe.run(
						sha,
						runId,
						o.kind,
						LEGACY_EXTRACTOR,
						o.data,
						o.observedAt,
					);
					count("observations");
				}
			}

			for (const r of plan.relationships) {
				const relationshipId = createRow(
					db,
					"relationships",
					{
						parent_id: idOf(r.parent),
						child_id: idOf(r.child),
						...r.fields,
						created_at: r.createdAt,
					},
					{ actor, now: r.createdAt, evidence: r.evidence },
				);
				from("relationships", Number(relationshipId), r.evidence);
				count("relationships");
			}

			const statementIds = new Map<number, number>();
			const insertStatement = db.prepare(
				`INSERT INTO statements (asset_id, text, author, organization, edited_with, saved_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			);
			for (const s of plan.statements) {
				const result = insertStatement.run(
					idOf(s.asset),
					s.text,
					s.author,
					s.organization,
					s.editedWith,
					s.savedAt,
				);
				statementIds.set(s.legacyId, Number(result.lastInsertRowid));
				from("statements", result.lastInsertRowid, {
					legacy: "public.creator_statements",
					id: s.legacyId,
				});
				count("statements");
			}

			const insertSignature = db.prepare(
				`INSERT INTO signatures (asset_id, kind, version, source_sha256, signed_sha256, run_id, engine,
				   signer_name, signer_issuer, timestamped, definition, statement_id, statement, report, status, signed_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const s of plan.signatures) {
				const assetId = idOf(s.asset);
				// The file signed is the asset's file unless it was found holding
				// other bytes; with neither found nor a hash, the asset's own.
				const source =
					place(s.source, assetId, s.signedAt) ?? contentOf.get(s.asset)!;
				const signed = place(s.signed, assetId, s.signedAt)!;
				const inserted = insertSignature.run(
					assetId,
					s.kind,
					s.version,
					source,
					signed,
					runId,
					LEGACY_SIGNING_ENGINE,
					s.signerName,
					s.signerIssuer,
					s.timestamped ? 1 : 0,
					s.definition,
					s.statementLegacyId === null
						? null
						: (statementIds.get(s.statementLegacyId) ?? null),
					s.statement,
					s.report,
					s.status,
					s.signedAt,
				);
				from("signatures", inserted.lastInsertRowid, {
					legacy: "public.signatures",
					id: s.legacyId,
				});
				count("signatures");
			}

			for (const t of plan.timelines) {
				const opts2 = { actor, now: t.updatedAt, evidence: t.evidence };
				const timelineId = Number(
					createRow(
						db,
						"timelines",
						{
							content_sha256: contentOf.get(t.asset)!,
							format: t.format,
							format_version: t.format_version,
							file_name: t.file_name,
							file_sha256: t.file.sha256!,
							sequence_name: t.sequence_name,
							timebase: t.timebase,
							ntsc: t.ntsc ? 1 : 0,
							fps: t.fps,
							duration_frames: t.duration_frames,
							width: t.width,
							height: t.height,
							primary_track_index: t.primary_track_index,
							include_overlays: t.include_overlays,
							breakdown: t.breakdown,
							notes: t.notes,
							imported_at: t.importedAt,
						},
						opts2,
					),
				);
				from("timelines", timelineId, t.evidence);
				count("timelines");
				for (const s of t.sources) {
					const sourceId = Number(
						createRow(
							db,
							"timeline_sources",
							{
								timeline_id: timelineId,
								source_key: s.source_key,
								kind: s.kind,
								name: s.name,
								path: s.path,
								asset_id: s.asset === null ? null : idOf(s.asset),
								match_method: s.match_method,
								match_confidence: s.match_confidence,
							},
							opts2,
						),
					);
					count("timeline_sources");
					for (const c of s.clips) {
						const { evidence, enabled, ...clip } = c;
						const clipId = createRow(
							db,
							"timeline_clips",
							{
								timeline_id: timelineId,
								source_id: sourceId,
								...clip,
								enabled: enabled ? 1 : 0,
							},
							{ ...opts2, evidence },
						);
						from("timeline_clips", Number(clipId), evidence);
						count("timeline_clips");
					}
				}
			}

			finishRun(db, runId, {
				outcome: "ok",
				summary: {
					legacy_project: plan.project.legacyId,
					dump_file: opts.source.dumpFile,
					counts,
					not_found: notFound.length,
					uncarried: plan.uncarried.length,
					notes: plan.notes.length,
					origins,
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
	return { runId, assetIds, counts, notFound, origins };
}
