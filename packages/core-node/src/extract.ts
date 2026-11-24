// extract: read what each file says, and keep it (D21, D30). For every live
// content with a file on this machine, each reader that has not yet read it
// at its current version reads it once; the result is an observation row
// that never changes. Sidecars (.xmp, .c2pa) are read as part of the file
// they sit beside. Running it again reads nothing; a new reader version
// reads again, beside the old rows.

import { statSync } from "node:fs";
import path from "node:path";
import {
	createRow,
	editRow,
	type Actor,
} from "@provenancetracker/core/catalog/edit.ts";
import { inTransaction } from "@provenancetracker/core/catalog/format.ts";
import { finishRun, startRun } from "@provenancetracker/core/catalog/runs.ts";
import { LIBRARY_EXTRACTOR } from "@provenancetracker/core/extraction/c2pa-library-read.ts";
import type { Observation } from "@provenancetracker/core/extraction/observation.ts";
import { pairSidecars } from "@provenancetracker/core/extraction/sidecars.ts";
import {
	loadLibraryReader,
	readC2paWithLibrary,
} from "./extract/c2pa-library.ts";
import { exiftoolVersion, readExif } from "./extract/exiftool.ts";
import { observePngText } from "./extract/png-text.ts";
import type { Machine } from "./machine.ts";
import { fetchesRemoteCredentials, readSettings } from "./settings.ts";
import type { OpenProject } from "./project.ts";
import { listRoots } from "./roots.ts";
import { UNSORTED } from "./scan.ts";
import { TOOL, TOOL_ACTOR_NAME } from "./tool.ts";

/** The kind extract gives a sidecar's asset, while nobody has said otherwise. */
export const SIDECAR = "sidecar";

/**
 * One reader: which kind it observes, its name and version (null when it
 * cannot run here: it is still asked, and says "unavailable"), and the read.
 */
export interface Reader {
	kind: Observation["kind"];
	extractor: string;
	version: string | null;
	read: (file: string, sidecar?: string) => Promise<Observation>;
}

/**
 * The readers on this machine: ExifTool, the C2PA library (the only reader
 * that may judge camera files, D15, D51; c2patool no longer reads), the PNG
 * text reader, and the sidecar readings.
 */
export async function machineReaders(machine: Machine): Promise<Reader[]> {
	const exif = await exiftoolVersion();
	const library = await loadLibraryReader(machine.env, {
		remoteManifests: fetchesRemoteCredentials(
			readSettings(machine.settingsPath),
		),
	});
	const c2pa = "unavailable" in library ? null : library.version;
	return [
		{
			kind: "exif",
			extractor: "exiftool",
			version: exif,
			read: async (f) => (await readExif(f)).observation,
		},
		{
			kind: "c2pa",
			extractor: LIBRARY_EXTRACTOR,
			version: c2pa,
			read: (f) => readC2paWithLibrary(library, f),
		},
		{
			kind: "png-text",
			extractor: TOOL.name,
			version: TOOL.version,
			read: (f) => observePngText(f),
		},
		{
			kind: "xmp-sidecar",
			extractor: "exiftool",
			version: exif,
			read: async (_f, sidecar) =>
				(await readExif(sidecar!, "xmp-sidecar")).observation,
		},
		{
			kind: "c2pa-sidecar",
			extractor: LIBRARY_EXTRACTOR,
			version: c2pa,
			read: (f, sidecar) => readC2paWithLibrary(library, f, sidecar),
		},
	];
}

const SIDECAR_KINDS = { xmp: "xmp-sidecar", c2pa: "c2pa-sidecar" } as const;

export interface ExtractReport {
	runId: number;
	outcome: "ok" | "cancelled";
	/** Contents with a file here that some reader still had to read. */
	contents: number;
	/** Observations written, by kind and status ("exif ok": 12). */
	written: Record<string, number>;
	sidecars: number;
	skipped: Array<{ root: string; path: string; reason: string }>;
	/** Contents with no live file on this machine; read when their root is here. */
	notHere: number;
}

interface LiveFile {
	sha256: string;
	rootId: number;
	root: string;
	path: string;
	abs: string;
	size: number;
	modifiedMs: number;
	assetId: number;
}

function unchangedSinceScan(f: LiveFile): boolean {
	try {
		const s = statSync(f.abs);
		return s.size === f.size && Math.floor(s.mtimeMs) === f.modifiedMs;
	} catch {
		return false;
	}
}

/** Read every content with a file on this machine that a reader has not read yet. */
export async function extractProject(
	project: OpenProject,
	machine: Machine,
	opts: {
		roots?: string[];
		/** Read everything again, beside what was read before (after a reader or how its output is read changed). */
		again?: boolean;
		readers?: Reader[];
		signal?: AbortSignal;
		onProgress?: (p: { done: number; total: number; file: string }) => void;
		now?: () => string;
	} = {},
): Promise<ExtractReport> {
	const { db } = project;
	const now = opts.now ?? (() => new Date().toISOString());
	const all = listRoots(project, machine);
	if (opts.roots) {
		const unknown = opts.roots.find((n) => !all.some((r) => r.name === n));
		if (unknown)
			throw new Error(`This project has no root called "${unknown}"`);
	}
	const here = all.filter(
		(r) => r.status === "ok" && (!opts.roots || opts.roots.includes(r.name)),
	);
	const readers = opts.readers ?? (await machineReaders(machine));
	const fileReaders = readers.filter((r) => !r.kind.endsWith("-sidecar"));
	const sidecarReaders = new Map(
		readers.filter((r) => r.kind.endsWith("-sidecar")).map((r) => [r.kind, r]),
	);

	const runId = startRun(db, { kind: "extract", tool: TOOL, now: now() });
	const actor: Actor = { kind: "tool", name: TOOL_ACTOR_NAME, runId };
	const report: ExtractReport = {
		runId,
		outcome: "ok",
		contents: 0,
		written: {},
		sidecars: 0,
		skipped: [],
		notHere: 0,
	};
	try {
		// Every live file in the roots that are here, by root.
		const files: LiveFile[] = [];
		const rows = db
			.prepare(
				`SELECT l.content_sha256 AS sha256, l.root_id AS rootId, l.path, l.modified_ms AS modifiedMs,
				        c.size, c.asset_id AS assetId
				 FROM locations l JOIN contents c ON c.sha256 = l.content_sha256
				 WHERE l.gone_run_id IS NULL ORDER BY l.root_id, l.path`,
			)
			.all() as unknown as Array<Omit<LiveFile, "root" | "abs">>;
		for (const row of rows) {
			const root = here.find((r) => r.id === row.rootId);
			if (!root?.folder) continue;
			files.push({
				...row,
				root: root.name,
				abs: path.join(root.folder, ...row.path.split("/")),
			});
		}
		const hereShas = new Set(files.map((f) => f.sha256));
		const live = db
			.prepare(
				"SELECT count(DISTINCT content_sha256) AS n FROM locations WHERE gone_run_id IS NULL",
			)
			.get() as { n: number };
		report.notHere = live.n - hereShas.size;

		const seen = db.prepare(
			`SELECT 1 FROM observations WHERE content_sha256 = ? AND kind = ? AND extractor = ? AND extractor_version = ?
			 AND source_sha256 IS ?`,
		);
		const insert = db.prepare(
			`INSERT INTO observations (content_sha256, source_sha256, run_id, kind, extractor, extractor_version,
			   status, data, error, warnings, validation, observed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const done = (sha: string, source: string | null, r: Reader) =>
			!opts.again &&
			Boolean(
				seen.get(sha, r.kind, r.extractor, r.version ?? "unknown", source),
			);
		const record = (sha: string, source: string | null, o: Observation) => {
			insert.run(
				sha,
				source,
				runId,
				o.kind,
				o.extractor,
				o.version,
				o.status,
				o.data === null ? null : JSON.stringify(o.data),
				o.error,
				JSON.stringify(o.warnings),
				o.validation === undefined || o.validation === null
					? null
					: JSON.stringify(o.validation),
				now(),
			);
			const key = `${o.kind} ${o.status}`;
			report.written[key] = (report.written[key] ?? 0) + 1;
		};

		// Sidecar pairs, per root: which live files describe which.
		type Job = { file: LiveFile; reader: Reader; sidecar?: LiveFile };
		const jobs: Job[] = [];
		const sidecarAssets: Array<{ sidecar: LiveFile; described: LiveFile }> = [];
		for (const root of here) {
			const inRoot = files.filter((f) => f.rootId === root.id);
			const byPath = new Map(inRoot.map((f) => [f.path, f]));
			for (const pair of pairSidecars(inRoot.map((f) => f.path))) {
				const sidecar = byPath.get(pair.sidecar)!;
				const reader = sidecarReaders.get(SIDECAR_KINDS[pair.kind]);
				for (const described of pair.files.map((p) => byPath.get(p)!)) {
					sidecarAssets.push({ sidecar, described });
					if (reader && !done(described.sha256, sidecar.sha256, reader))
						jobs.push({ file: described, reader, sidecar });
				}
			}
		}
		// One file per content is enough: the same bytes say the same thing.
		const firstFile = new Map<string, LiveFile>();
		for (const f of files)
			if (!firstFile.has(f.sha256)) firstFile.set(f.sha256, f);
		for (const f of firstFile.values())
			for (const reader of fileReaders)
				if (!done(f.sha256, null, reader)) jobs.push({ file: f, reader });
		report.contents = new Set(jobs.map((j) => j.file.sha256)).size;

		// Read, one job at a time, each written as soon as it is read. A file
		// is reported once however many readers it was due for.
		let finished = 0;
		const reported = new Set<string>();
		const skip = (f: LiveFile, reason: string) => {
			const key = `${f.rootId}/${f.path}`;
			if (reported.has(key)) return;
			reported.add(key);
			report.skipped.push({ root: f.root, path: f.path, reason });
		};
		for (const job of jobs) {
			opts.onProgress?.({
				done: finished,
				total: jobs.length,
				file: `${job.file.root}/${job.file.path}`,
			});
			if (opts.signal?.aborted) {
				report.outcome = "cancelled";
				break;
			}
			const involved = job.sidecar ? [job.file, job.sidecar] : [job.file];
			const changed = involved.find((f) => !unchangedSinceScan(f));
			if (changed) {
				skip(changed, "changed or gone since the last scan; scan again");
				continue;
			}
			const observation = await job.reader.read(job.file.abs, job.sidecar?.abs);
			if (involved.some((f) => !unchangedSinceScan(f))) {
				skip(job.file, "changed while it was being read; scan again");
				continue;
			}
			inTransaction(db, () =>
				record(job.file.sha256, job.sidecar?.sha256 ?? null, observation),
			);
			finished++;
		}

		// Sidecars: their asset says so, and is linked to the file it describes.
		inTransaction(db, () => {
			const kindOf = db.prepare("SELECT kind FROM assets WHERE id = ?");
			const linked = db.prepare(
				"SELECT 1 FROM relationships WHERE parent_id = ? AND child_id = ? AND type = 'sidecar_of'",
			);
			const counted = new Set<number>();
			for (const { sidecar, described } of sidecarAssets) {
				if (sidecar.assetId === described.assetId) continue;
				const kind = (kindOf.get(sidecar.assetId) as { kind: string }).kind;
				if (kind === UNSORTED)
					editRow(
						db,
						"assets",
						sidecar.assetId,
						{ kind: SIDECAR },
						{ actor, now: now() },
					);
				if (!linked.get(described.assetId, sidecar.assetId))
					createRow(
						db,
						"relationships",
						{
							parent_id: described.assetId,
							child_id: sidecar.assetId,
							type: "sidecar_of",
							match_method: "filename_pattern",
						},
						{ actor, now: now() },
					);
				counted.add(sidecar.assetId);
			}
			report.sidecars = counted.size;
			finishRun(db, runId, {
				outcome: report.outcome,
				summary: {
					contents: report.contents,
					written: report.written,
					sidecars: report.sidecars,
					notHere: report.notHere,
					skipped: report.skipped.slice(0, 100),
					skippedCount: report.skipped.length,
				},
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
