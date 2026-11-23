// scan: list each root on this machine, hash what is new or changed, and
// record where every content is (core/catalog/rescan.ts decides; this module
// walks, hashes and writes). One run per scan; each file's change is written
// in its own transaction, so an interrupted scan keeps what it finished.

import { readdirSync, statSync, type Stats } from "node:fs";
import path from "node:path";
import { createRow, type Actor } from "@provenancetracker/core/catalog/edit.ts";
import { inTransaction } from "@provenancetracker/core/catalog/format.ts";
import { isCatalogPath } from "@provenancetracker/core/catalog/paths.ts";
import {
	classifyFile,
	planRescan,
	type FileChange,
	type KnownLocation,
	type SeenFile,
} from "@provenancetracker/core/catalog/rescan.ts";
import { finishRun, startRun } from "@provenancetracker/core/catalog/runs.ts";
import { sha256OfFile } from "./hash.ts";
import type { Machine } from "./machine.ts";
import type { OpenProject } from "./project.ts";
import { listRoots } from "./roots.ts";
import { TOOL, TOOL_ACTOR_NAME } from "./tool.ts";

/** The kind a scan gives an asset it finds; a person or extract sorts it later. */
export const UNSORTED = "unsorted";

/** Names a scan passes over: hidden files and folders, and the systems' own clutter. */
export function isIgnoredName(name: string): boolean {
	return name.startsWith(".") || name === "Thumbs.db" || name === "desktop.ini";
}

export interface SkippedFile {
	root: string;
	path: string;
	reason: string;
}

export interface ScanReport {
	runId: number;
	outcome: "ok" | "cancelled";
	roots: Array<{
		name: string;
		folder: string | null;
		scanned: boolean;
		reason?: string;
		files: number;
	}>;
	counts: {
		files: number;
		unchanged: number;
		touched: number;
		added: number;
		moved: number;
		replaced: number;
		gone: number;
		newAssets: number;
		newVersions: number;
		hashedBytes: number;
	};
	skipped: SkippedFile[];
	/** Bytes found at more than one live path. */
	duplicates: Array<{
		sha256: string;
		places: Array<{ root: string; path: string }>;
	}>;
}

export interface ScanProgress {
	hashed: number;
	toHash: number;
	bytes: number;
	file: string;
}

interface Listing {
	files: SeenFile[];
	/** Catalog paths (folders or files) that could not be read; "" is the whole root. */
	unreadable: string[];
	skipped: SkippedFile[];
}

function modifiedMs(stats: Stats): number {
	return Math.floor(stats.mtimeMs);
}

function listRoot(rootId: number, rootName: string, folder: string): Listing {
	const out: Listing = { files: [], unreadable: [], skipped: [] };
	const pending: string[] = [""];
	while (pending.length) {
		const rel = pending.pop()!;
		const dir = rel ? path.join(folder, ...rel.split("/")) : folder;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch (err) {
			out.unreadable.push(rel);
			out.skipped.push({
				root: rootName,
				path: rel || ".",
				reason: `folder could not be read (${(err as NodeJS.ErrnoException).code})`,
			});
			continue;
		}
		for (const entry of entries) {
			if (isIgnoredName(entry.name)) continue;
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isSymbolicLink()) {
				out.skipped.push({
					root: rootName,
					path: child,
					reason: "a link; links are not followed",
				});
				continue;
			}
			if (!isCatalogPath(child)) {
				out.skipped.push({
					root: rootName,
					path: child,
					reason: "a name the catalog cannot store",
				});
				continue;
			}
			if (entry.isDirectory()) {
				pending.push(child);
				continue;
			}
			if (!entry.isFile()) continue;
			try {
				const stats = statSync(path.join(dir, entry.name));
				out.files.push({
					rootId,
					path: child,
					size: stats.size,
					modifiedMs: modifiedMs(stats),
				});
			} catch (err) {
				out.unreadable.push(child);
				out.skipped.push({
					root: rootName,
					path: child,
					reason: `could not be read (${(err as NodeJS.ErrnoException).code})`,
				});
			}
		}
	}
	return out;
}

function knownLocations(project: OpenProject): KnownLocation[] {
	return project.db
		.prepare(
			`SELECT l.id, l.root_id AS rootId, l.path, l.content_sha256 AS sha256, c.size, l.modified_ms AS modifiedMs
			 FROM locations l JOIN contents c ON c.sha256 = l.content_sha256
			 WHERE l.gone_run_id IS NULL`,
		)
		.all() as unknown as KnownLocation[];
}

/**
 * Scan the project's roots that are on this machine (or the named ones).
 * A root not located here, or whose folder is missing, is skipped and its
 * files left as they were.
 */
export async function scanProject(
	project: OpenProject,
	machine: Machine,
	opts: {
		roots?: string[];
		signal?: AbortSignal;
		onProgress?: (p: ScanProgress) => void;
		now?: () => string;
	} = {},
): Promise<ScanReport> {
	const { db } = project;
	const now = opts.now ?? (() => new Date().toISOString());
	const all = listRoots(project, machine);
	if (opts.roots) {
		const unknown = opts.roots.filter((n) => !all.some((r) => r.name === n));
		if (unknown.length)
			throw new Error(`This project has no root called "${unknown[0]}"`);
	}
	const chosen = opts.roots
		? all.filter((r) => opts.roots!.includes(r.name))
		: all;

	const runId = startRun(db, { kind: "scan", tool: TOOL, now: now() });
	const actor: Actor = { kind: "tool", name: TOOL_ACTOR_NAME, runId };
	const report: ScanReport = {
		runId,
		outcome: "ok",
		roots: [],
		counts: {
			files: 0,
			unchanged: 0,
			touched: 0,
			added: 0,
			moved: 0,
			replaced: 0,
			gone: 0,
			newAssets: 0,
			newVersions: 0,
			hashedBytes: 0,
		},
		skipped: [],
		duplicates: [],
	};
	const names = new Map(all.map((r) => [r.id, r.name]));
	const folders = new Map<number, string>();
	try {
		// 1. List every chosen root that is here. Nothing is hashed yet.
		const seen: SeenFile[] = [];
		const unreadable = new Map<number, string[]>();
		for (const root of chosen) {
			if (root.status !== "ok" || root.folder === null) {
				report.roots.push({
					name: root.name,
					folder: root.folder,
					scanned: false,
					reason: root.status,
					files: 0,
				});
				continue;
			}
			const listing = listRoot(root.id, root.name, root.folder);
			folders.set(root.id, root.folder);
			unreadable.set(root.id, listing.unreadable);
			seen.push(...listing.files);
			report.skipped.push(...listing.skipped);
			report.roots.push({
				name: root.name,
				folder: root.folder,
				scanned: true,
				files: listing.files.length,
			});
		}
		report.counts.files = seen.length;

		// 2. Compare with the catalog.
		const listed = (k: KnownLocation) => {
			const holes = unreadable.get(k.rootId);
			if (!holes) return false;
			return !holes.some(
				(h) => h === "" || k.path === h || k.path.startsWith(`${h}/`),
			);
		};
		const plan = planRescan(knownLocations(project), seen, listed);
		report.counts.unchanged = plan.unchanged.length;
		const missing = [...plan.missing];

		// 3. Hash what is new or changed, writing each file as it is done.
		const assetOf = db.prepare(
			"SELECT asset_id FROM contents WHERE sha256 = ?",
		);
		const insertLocation = db.prepare(
			`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		);
		const markGone = db.prepare(
			"UPDATE locations SET gone_run_id = ? WHERE id = ?",
		);
		const touch = db.prepare(
			"UPDATE locations SET modified_ms = ?, last_seen_run_id = ? WHERE id = ?",
		);
		const toHash = [...plan.toHash].sort(
			(a, b) => a.rootId - b.rootId || (a.path < b.path ? -1 : 1),
		);
		let hashed = 0;
		for (const file of toHash) {
			const rootName = names.get(file.rootId)!;
			const abs = path.join(folders.get(file.rootId)!, ...file.path.split("/"));
			opts.onProgress?.({
				hashed,
				toHash: toHash.length,
				bytes: report.counts.hashedBytes,
				file: `${rootName}/${file.path}`,
			});
			if (opts.signal?.aborted) {
				report.outcome = "cancelled";
				break;
			}
			let sha256: string;
			try {
				sha256 = await sha256OfFile(abs);
				const after = statSync(abs);
				if (after.size !== file.size || modifiedMs(after) !== file.modifiedMs) {
					report.skipped.push({
						root: rootName,
						path: file.path,
						reason: "changed while it was being read; scan again",
					});
					continue;
				}
			} catch (err) {
				report.skipped.push({
					root: rootName,
					path: file.path,
					reason: `could not be read (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`,
				});
				continue;
			}
			hashed++;
			report.counts.hashedBytes += file.size;
			inTransaction(db, () => {
				const change: FileChange = classifyFile(
					{ ...file, sha256 },
					{
						assetOf: (sha) =>
							(assetOf.get(sha) as { asset_id: number } | undefined)?.asset_id,
						missing,
					},
				);
				if (change.kind === "touched") {
					touch.run(file.modifiedMs, runId, change.previous.id);
					report.counts.touched++;
					return;
				}
				if (change.kind === "replaced") {
					markGone.run(runId, change.previous.id);
					report.counts.replaced++;
				} else {
					report.counts.added++;
					if (change.movedFrom) {
						markGone.run(runId, change.movedFrom.id);
						report.counts.moved++;
					}
				}
				if (change.content.kind !== "known") {
					let assetId: number;
					if (change.content.kind === "new-asset") {
						assetId = Number(
							createRow(
								db,
								"assets",
								{ kind: UNSORTED },
								{ actor, now: now() },
							),
						);
						report.counts.newAssets++;
					} else {
						assetId = change.content.assetId;
						report.counts.newVersions++;
					}
					createRow(
						db,
						"contents",
						{ sha256, size: file.size, asset_id: assetId, first_run_id: runId },
						{ actor, now: now() },
					);
				}
				insertLocation.run(
					sha256,
					file.rootId,
					file.path,
					file.modifiedMs,
					runId,
					runId,
				);
			});
		}

		// 4. Seal: what was not hashed was seen as it was; what is missing is gone.
		inTransaction(db, () => {
			const seenAgain = db.prepare(
				"UPDATE locations SET last_seen_run_id = ? WHERE id = ?",
			);
			for (const k of plan.unchanged) seenAgain.run(runId, k.id);
			if (report.outcome === "ok") {
				for (const k of missing) markGone.run(runId, k.id);
				// Moved files are counted as moves, not as gone.
				report.counts.gone = missing.length;
			}
			report.duplicates = duplicates(project, names);
			finishRun(db, runId, {
				outcome: report.outcome,
				summary: summaryOf(report),
				now: now(),
			});
		});
		return report;
	} catch (err) {
		if (db.isTransaction) db.exec("ROLLBACK");
		finishRun(db, runId, {
			outcome: "failed",
			summary: { error: (err as Error).message },
			now: now(),
		});
		throw err;
	}
}

function duplicates(
	project: OpenProject,
	names: Map<number, string>,
): ScanReport["duplicates"] {
	const rows = project.db
		.prepare(
			`SELECT content_sha256 AS sha256, root_id AS rootId, path FROM locations
			 WHERE gone_run_id IS NULL AND content_sha256 IN (
			   SELECT content_sha256 FROM locations WHERE gone_run_id IS NULL
			   GROUP BY content_sha256 HAVING count(*) > 1)
			 ORDER BY content_sha256, root_id, path`,
		)
		.all() as unknown as Array<{
		sha256: string;
		rootId: number;
		path: string;
	}>;
	const out: ScanReport["duplicates"] = [];
	for (const row of rows) {
		if (out.at(-1)?.sha256 !== row.sha256)
			out.push({ sha256: row.sha256, places: [] });
		out.at(-1)!.places.push({
			root: names.get(row.rootId) ?? String(row.rootId),
			path: row.path,
		});
	}
	return out;
}

function summaryOf(report: ScanReport): Record<string, unknown> {
	return {
		counts: report.counts,
		roots: report.roots.map((r) => ({
			name: r.name,
			scanned: r.scanned,
			files: r.files,
			...(r.reason ? { reason: r.reason } : {}),
		})),
		duplicates: report.duplicates.length,
		// The first hundred, so a run on a folder of unreadable files stays small.
		skipped: report.skipped.slice(0, 100),
		skippedCount: report.skipped.length,
	};
}
