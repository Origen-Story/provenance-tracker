// The Postgres migration (roadmap Phase 5). The dry run builds each
// project's catalog from a checked dump in a throwaway folder, runs every
// check on it, reports and deletes it; the project folders and media are only
// read, and this machine's settings are not touched (the roots are placed in
// a throwaway settings file). The real run does the same and then, only if
// every check of every project holds, puts each catalog in its project folder
// beside its timeline files, never replacing a catalog already there.
//
// What a project's catalog is made from is a layout file kept outside the
// repository, since it holds this machine's paths:
//
//   {
//     "dumps": "D:/backups/postgres",
//     "dump": { "file": "app_2026-11-21_223001.dump", "sha256": "<64 hex>" },
//     "projects": [
//       { "legacy": "demo-film", "folder": "D:/demo-film",
//         "roots": { "footage": "D:/demo-film/footage", "archive": "E:/archive" } }
//     ]
//   }
//
// "dump" names the backup of record: the dump whose off-machine copy was
// restored and checked. The real run reads only that one, and stops if a
// newer dump's data differs from it (Postgres changed since the backup).
// Without it the dry run reads the newest dump. "legacy" is the project's
// name in Postgres; each root is a name and its folder (inside the project
// folder, it travels with it, D32).

import { randomUUID } from "node:crypto";
import {
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCatalog } from "@provenancetracker/core/catalog/create.ts";
import type { Actor } from "@provenancetracker/core/catalog/edit.ts";
import {
	isFullPath,
	isWithin,
	toCatalogPath,
} from "@provenancetracker/core/catalog/paths.ts";
import {
	verifyCatalog,
	type Problem,
} from "@provenancetracker/core/catalog/verify.ts";
import { buildPublicExportV1 } from "@provenancetracker/core/manifest/public-export.js";
import {
	cachedBreakdown,
	differences,
	findOrphans,
	legacyIds,
	recomputeBreakdown,
	signatureForExport,
	tableDifferences,
} from "@provenancetracker/core/legacy/checks.ts";
import {
	parseCopyText,
	pgInteger,
	pgReal,
	pgTimestamp,
	type CopyRow,
	type CopyTable,
} from "@provenancetracker/core/legacy/copy-text.ts";
import {
	legacyProjects,
	planProject,
	type MigrationPlan,
} from "@provenancetracker/core/legacy/plan.ts";
import {
	fileProblems,
	writeMigration,
	type FileFact,
} from "@provenancetracker/core/legacy/write.ts";
import { extractProject, type Reader } from "../extract.ts";
import type { Machine } from "../machine.ts";
import {
	newProjectFolder,
	openProject,
	placeNewCatalog,
	placeWithoutReplacing,
	PROJECT_DIR,
	realFolder,
	TIMELINES_DIR,
	type OpenProject,
} from "../project.ts";
import { addRoot, listRoots, type RootView } from "../roots.ts";
import { scanProject } from "../scan.ts";
import { projectEntry, updateSettings } from "../settings.ts";
import { TOOL } from "../tool.ts";
import {
	checkDump,
	listDumps,
	restoreToText,
	sha256OfFile,
	type DumpFile,
} from "./dump.ts";

export interface LayoutProject {
	/** The project's name in Postgres. */
	legacy: string;
	/** Where the project folder is (or will be): the catalog goes inside it. */
	folder: string;
	/** Root name → folder. */
	roots: Record<string, string>;
}

export interface MigrationLayout {
	/** The folder of the backup task's dumps. */
	dumps: string;
	/** The backup of record: the one dump the real run reads. */
	dump?: { file: string; sha256: string };
	projects: LayoutProject[];
}

/** Read and check a layout file. */
export function readLayout(
	file: string,
	platform: NodeJS.Platform = process.platform,
): MigrationLayout {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch (err) {
		throw new Error(
			`The layout file ${file} is not readable JSON: ${(err as Error).message}`,
			{ cause: err },
		);
	}
	const problems: string[] = [];
	const full = (p: unknown, what: string) => {
		if (typeof p !== "string" || !isFullPath(p, platform))
			problems.push(`${what} must be a full path`);
	};
	const l = raw as Partial<MigrationLayout>;
	full(l?.dumps, "dumps");
	if (l?.dump !== undefined) {
		const d = l.dump as Partial<{ file: unknown; sha256: unknown }> | null;
		if (
			typeof d?.file !== "string" ||
			!d.file ||
			path.basename(d.file) !== d.file
		)
			problems.push("dump.file must be a dump's file name, without a folder");
		if (typeof d?.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(d.sha256))
			problems.push("dump.sha256 must be the dump's SHA-256 (64 hex digits)");
	}
	if (!Array.isArray(l?.projects) || l.projects.length === 0)
		problems.push("projects must list at least one project");
	const seen = new Set<string>();
	for (const [i, p] of (Array.isArray(l?.projects)
		? l.projects
		: []
	).entries()) {
		const what = `projects[${i}]`;
		if (typeof p?.legacy !== "string" || !p.legacy.trim())
			problems.push(`${what}.legacy must name a Postgres project`);
		else if (seen.has(p.legacy))
			problems.push(`${what}: ${p.legacy} is listed twice`);
		else seen.add(p.legacy);
		full(p?.folder, `${what}.folder`);
		if (
			!p?.roots ||
			typeof p.roots !== "object" ||
			Array.isArray(p.roots) ||
			Object.keys(p.roots).length === 0
		)
			problems.push(`${what}.roots must name at least one root and its folder`);
		else
			for (const [name, folder] of Object.entries(p.roots))
				full(folder, `${what}.roots.${name}`);
	}
	if (problems.length)
		throw new Error(
			`The layout file ${file} is not usable:\n- ${problems.join("\n- ")}`,
		);
	return l as MigrationLayout;
}

export interface FileCheck {
	path: string;
	found: boolean;
	root?: string;
	catalogPath?: string;
	reason?: string;
}

export interface ProjectDryRun {
	legacy: { id: number; name: string };
	folder: string;
	folderExists: boolean;
	roots: Array<
		Pick<RootView, "name" | "folder" | "inProject" | "status" | "warnings">
	>;
	plan: {
		assets: number;
		blocking: string[];
		notes: string[];
		/** Not-carried values, counted by table.column, with the first value of each. */
		uncarried: Array<{
			column: string;
			count: number;
			why: string;
			example: string | null;
		}>;
	};
	/** Problems that stop the write: files, layout, timeline files. */
	problems: string[];
	files: FileCheck[];
	written: Record<string, number> | null;
	notFound: Array<{ path: string; reason: string }>;
	verify: Problem[];
	breakdowns: Array<{
		timeline: number;
		same: boolean;
		differences: string[];
		/** The cache predates asset refs (D23) and was read as the app reads it. */
		oldShape: boolean;
	}>;
	exports: Array<{
		signature: number;
		same: boolean;
		differences: string[];
		note?: string;
	}>;
	technical: { compared: number; differences: string[] } | null;
	scan: {
		unchanged: number;
		added: number;
		gone: number;
		addedFiles: string[];
	} | null;
	error: string | null;
	ok: boolean;
}

export interface DryRunReport {
	dump: { file: string; sha256: string; pinned: boolean };
	/**
	 * The newest dump, when it is not the one read: whether its data differs
	 * (Postgres changed since the backup). Null when the newest was read.
	 */
	sinceBackup: { newest: string; differences: string[] } | null;
	orphans: string[];
	/** Postgres projects the layout does not name: not migrated. */
	notInLayout: Array<{ id: number; name: string }>;
	projects: ProjectDryRun[];
	ok: boolean;
}

export interface PlacedProject {
	name: string;
	folder: string;
	catalogPath: string;
	timelineFiles: number;
	/** The placed catalog, opened and checked again. */
	verify: Problem[];
	roots: Array<Pick<RootView, "name" | "folder" | "inProject" | "status">>;
}

export interface MigrationReport extends DryRunReport {
	/** Why nothing was placed, if it was not. */
	refused: string | null;
	placed: PlacedProject[];
}

export interface DryRunOptions {
	layout: MigrationLayout;
	machine: Machine;
	/** Who adds the roots (they are the person's choice of layout). */
	actor: Actor;
	/** The ExifTool reader for the technical comparison (tests pass their own; none skips it). */
	exifReader?: Reader | null;
	pgRestore?: string;
	/** Turns the dump into its plain SQL (pg_restore; tests write the text themselves). */
	restore?: (dump: string, out: string) => Promise<void>;
	progress?: (line: string) => void;
}

/** The generator and time both exports are built with, so only the record can differ. */
const EXPORT_STAMP = {
	generatedAt: "2000-01-01T00:00:00.000Z",
	generator: { name: "provenance-tracker", version: "dry-run" },
};

/** The dump to read: the layout's backup of record, checked, or else the newest. */
async function chooseDump(
	layout: MigrationLayout,
	say: (line: string) => void,
): Promise<{ dump: DumpFile; sha256: string; newest: DumpFile }> {
	const dumps = listDumps(layout.dumps);
	if (!dumps.length)
		throw new Error(
			`There is no finished dump (with its .sha256) in ${layout.dumps}`,
		);
	const newest = dumps[0];
	const pinned = layout.dump;
	const dump = pinned ? dumps.find((d) => d.name === pinned.file) : newest;
	if (!dump)
		throw new Error(
			`The layout's dump ${pinned!.file} is not in ${layout.dumps} (with its .sha256 beside it)`,
		);
	say(`Checking ${dump.name} against its .sha256`);
	const sha256 = await checkDump(dump.file);
	if (pinned && sha256 !== pinned.sha256.toLowerCase())
		throw new Error(
			`${dump.name} is not the backup the layout names: its SHA-256 is ${sha256}, the layout says ${pinned.sha256.toLowerCase()}`,
		);
	return { dump, sha256, newest };
}

async function readDump(
	file: string,
	temp: string,
	opts: DryRunOptions,
): Promise<Map<string, CopyTable>> {
	const text = path.join(temp, `${path.basename(file)}.sql`);
	await (
		opts.restore ??
		((d, o) => restoreToText(d, o, { pgRestore: opts.pgRestore }))
	)(file, text);
	try {
		return parseCopyText(readFileSync(text, "utf8"));
	} finally {
		rmSync(text, { force: true });
	}
}

/** Build and check every project in `temp`; nothing outside it is written. */
async function buildAll(
	opts: DryRunOptions,
	temp: string,
): Promise<{ report: DryRunReport; builds: Build[] }> {
	const say = opts.progress ?? (() => {});
	const { dump, sha256, newest } = await chooseDump(opts.layout, say);
	say("Reading it with pg_restore");
	const tables = await readDump(dump.file, temp, opts);
	let sinceBackup: DryRunReport["sinceBackup"] = null;
	if (newest.name !== dump.name) {
		say(`Comparing it with the newest dump, ${newest.name}`);
		await checkDump(newest.file);
		sinceBackup = {
			newest: newest.name,
			differences: tableDifferences(
				tables,
				await readDump(newest.file, temp, opts),
			),
		};
	}
	const inDump = legacyProjects(tables);
	for (const p of opts.layout.projects)
		if (!inDump.some((d) => d.name === p.legacy))
			throw new Error(
				`The layout names "${p.legacy}", which the dump does not have (it has: ${inDump.map((d) => d.name).join(", ")})`,
			);
	const report: DryRunReport = {
		dump: { file: dump.name, sha256, pinned: !!opts.layout.dump },
		sinceBackup,
		orphans: findOrphans(tables),
		notInLayout: inDump.filter(
			(d) => !opts.layout.projects.some((p) => p.legacy === d.name),
		),
		projects: [],
		ok: false,
	};
	const builds: Build[] = [];
	for (const [i, p] of opts.layout.projects.entries()) {
		const legacy = inDump.find((d) => d.name === p.legacy)!;
		say(`Project ${legacy.name}`);
		const build = await buildProject(
			tables,
			legacy,
			p,
			path.join(temp, String(i)),
			{ name: dump.name, sha256 },
			opts,
			say,
		);
		builds.push(build);
		report.projects.push(build.report);
	}
	report.ok =
		report.orphans.length === 0 &&
		(sinceBackup?.differences.length ?? 0) === 0 &&
		report.projects.every((p) => p.ok);
	return { report, builds };
}

/** Build and check every project's catalog in a throwaway folder; keep nothing. */
export async function dryRun(opts: DryRunOptions): Promise<DryRunReport> {
	const temp = mkdtempSync(path.join(tmpdir(), "pt-migrate-dry-run-"));
	try {
		return (await buildAll(opts, temp)).report;
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

/**
 * The real run: the dry run's builds and checks, then, only if every check
 * of every project holds and no project folder has a catalog yet, each
 * catalog put in its project folder. It reads only the layout's backup of
 * record, and stops if a newer dump's data differs from it.
 */
export async function migrate(opts: DryRunOptions): Promise<MigrationReport> {
	if (!opts.layout.dump)
		throw new Error(
			'The real run reads only the backup of record: name it in the layout as "dump": { "file": "<dump file name>", "sha256": "<its SHA-256>" }',
		);
	const say = opts.progress ?? (() => {});
	const temp = mkdtempSync(path.join(tmpdir(), "pt-migrate-"));
	try {
		const { report, builds } = await buildAll(opts, temp);
		const out: MigrationReport = { ...report, refused: null, placed: [] };
		if (report.sinceBackup?.differences.length) {
			out.refused = `Postgres has changed since the backup: ${report.sinceBackup.newest} differs from ${report.dump.file}. Nothing was placed. A fresh dump has to go through a nightly off-machine backup and be checked first.`;
			return out;
		}
		if (!report.ok) {
			out.refused = "Not every check holds (see above). Nothing was placed.";
			return out;
		}
		// Every target is checked before any is written.
		const targets = opts.layout.projects.map((p) =>
			newProjectFolder(p.folder, opts.machine),
		);
		for (const [i, build] of builds.entries()) {
			say(`Placing ${build.report.legacy.name} in ${targets[i].folder}`);
			out.placed.push(await place(build, targets[i], opts.machine));
		}
		out.ok = out.placed.every(
			(p) => p.verify.length === 0 && p.roots.every((r) => r.status === "ok"),
		);
		return out;
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

/**
 * Put one built catalog in its project folder: the timeline files first
 * (each copied under a temporary name, its hash checked, then given its
 * name), then the catalog (placeNewCatalog: checked, never replacing one),
 * then this machine's places for the roots outside the project folder. The
 * placed catalog is opened and checked again.
 */
async function place(
	build: Build,
	target: { folder: string; catalogPath: string },
	machine: Machine,
): Promise<PlacedProject> {
	if (!build.snapshot) throw new Error("Nothing was built to place");
	const dir = path.join(target.folder, PROJECT_DIR, TIMELINES_DIR);
	mkdirSync(dir, { recursive: true });
	for (const [sha, source] of build.timelineFiles) {
		const dest = path.join(dir, sha);
		if (existsSync(dest)) {
			if ((await sha256OfFile(dest)) !== sha)
				throw new Error(`${dest} is there already, with other bytes`);
			continue;
		}
		const temp = `${dest}.new`;
		try {
			copyFileSync(source, temp, constants.COPYFILE_EXCL);
			if ((await sha256OfFile(temp)) !== sha)
				throw new Error(`${source} changed while it was copied`);
			placeWithoutReplacing(temp, dest);
		} finally {
			rmSync(temp, { force: true });
		}
	}
	placeNewCatalog(target, build.projectId, machine, (temp) =>
		copyFileSync(build.snapshot!, temp, constants.COPYFILE_EXCL),
	);
	if (build.outside.length)
		updateSettings(machine.settingsPath, (s) => {
			const roots = projectEntry(s, build.projectId).roots;
			for (const o of build.outside) roots[String(o.id)] = o.folder;
		});
	const project = openProject(target.folder, { machine });
	try {
		return {
			name: build.report.legacy.name,
			folder: target.folder,
			catalogPath: target.catalogPath,
			timelineFiles: build.timelineFiles.size,
			verify: verifyCatalog(project.db),
			roots: listRoots(project, machine).map(
				({ name, folder, inProject, status }) => ({
					name,
					folder,
					inProject,
					status,
				}),
			),
		};
	} finally {
		project.db.close();
	}
}
function groupUncarried(
	plan: MigrationPlan,
): ProjectDryRun["plan"]["uncarried"] {
	const out = new Map<string, ProjectDryRun["plan"]["uncarried"][number]>();
	for (const u of plan.uncarried) {
		const column = `${u.table}.${u.column}`;
		const g = out.get(column);
		if (g) g.count++;
		else out.set(column, { column, count: 1, why: u.why, example: u.value });
	}
	return [...out.values()];
}

/** One project's catalog, built and checked in the temp folder. */
interface Build {
	report: ProjectDryRun;
	projectId: string;
	/** The catalog as the migration left it, before the checks scanned and read files into it. */
	snapshot: string | null;
	/** Roots outside the project folder, to place in this machine's settings. */
	outside: Array<{ id: number; folder: string }>;
	/** Each timeline file to copy into the project: SHA-256 → where it is now. */
	timelineFiles: Map<string, string>;
}

async function buildProject(
	tables: Map<string, CopyTable>,
	legacy: { id: number; name: string },
	layout: LayoutProject,
	temp: string,
	dump: { name: string; sha256: string },
	opts: DryRunOptions,
	say: (line: string) => void,
): Promise<Build> {
	const platform = opts.machine.platform;
	const folder = realFolder(layout.folder);
	const plan = planProject(tables, legacy.id);
	const out: ProjectDryRun = {
		legacy,
		folder,
		folderExists: existsSync(folder),
		roots: [],
		plan: {
			assets: plan.assets.length,
			blocking: plan.blocking,
			notes: plan.notes,
			uncarried: groupUncarried(plan),
		},
		problems: [],
		files: [],
		written: null,
		notFound: [],
		verify: [],
		breakdowns: [],
		exports: [],
		technical: null,
		scan: null,
		error: null,
		ok: false,
	};
	// A throwaway machine: the catalog and settings live in the temp folder.
	mkdirSync(temp, { recursive: true });
	const machine: Machine = {
		...opts.machine,
		settingsPath: path.join(temp, "settings.json"),
	};
	const catalogPath = path.join(temp, "catalog.sqlite");
	const db = new DatabaseSync(catalogPath);
	const projectId = randomUUID();
	const build: Build = {
		report: out,
		projectId,
		snapshot: null,
		outside: [],
		timelineFiles: new Map(),
	};
	const project: OpenProject = {
		db,
		folder,
		catalogPath,
		projectId,
		name: plan.project.name,
		upgraded: null,
	};
	try {
		createCatalog(db, { projectId, name: plan.project.name, tool: TOOL });

		for (const [name, rootFolder] of Object.entries(layout.roots)) {
			try {
				addRoot(project, machine, {
					name,
					folder: rootFolder,
					actor: opts.actor,
				});
			} catch (err) {
				out.problems.push(`root ${name}: ${(err as Error).message}`);
			}
		}
		const roots = listRoots(project, machine);
		build.outside = roots
			.filter((r) => !r.inProject && r.folder !== null)
			.map((r) => ({ id: r.id, folder: r.folder! }));
		out.roots = roots.map(
			({ name, folder: f, inProject, status, warnings }) => ({
				name,
				folder: f,
				inProject,
				status,
				warnings,
			}),
		);

		// Every file Postgres names: found, in which root, and its bytes.
		const facts = new Map<string, FileFact>();
		const paths = [
			...new Set([
				...plan.assets.map((a) => a.file.path),
				...plan.signatures.flatMap((s) => [s.source.path, s.signed.path]),
			]),
		];
		for (const [n, p] of paths.entries()) {
			say(`  file ${n + 1}/${paths.length}: ${p}`);
			const { fact, check } = await findFile(p, roots, platform);
			facts.set(p, fact);
			out.files.push(check);
			if (check.reason === "outside every root")
				out.problems.push(`${p} is outside every root of the layout`);
		}
		const factOf = (p: string): FileFact =>
			facts.get(p) ?? { found: false, reason: "not looked for" };
		out.problems.push(...fileProblems(plan, factOf));

		const timelineFiles = new Set<string>();
		for (const t of plan.timelines) {
			const p = path.resolve(t.file.path);
			if (!existsSync(p))
				out.problems.push(
					`timeline ${t.evidence.id}: its file ${t.file.path} is not there`,
				);
			else if ((await sha256OfFile(p)) !== t.file.sha256)
				out.problems.push(
					`timeline ${t.evidence.id}: its file ${t.file.path} holds other bytes than Postgres recorded`,
				);
			else {
				timelineFiles.add(t.file.sha256!);
				build.timelineFiles.set(t.file.sha256!, p);
			}
		}

		if (plan.blocking.length || out.problems.length) return build;

		say("  writing the catalog");
		const result = writeMigration(db, plan, {
			facts: factOf,
			timelineFiles: (s) => timelineFiles.has(s),
			source: { dumpFile: dump.name, dumpSha256: dump.sha256 },
			tool: TOOL,
		});
		out.written = result.counts;
		out.notFound = result.notFound;
		out.verify = verifyCatalog(db);
		if (out.verify.length === 0) {
			// What the real run places: the catalog as the migration wrote it.
			// The checks below then scan and read files into this working copy.
			build.snapshot = path.join(temp, "migrated.sqlite");
			db.exec(`VACUUM INTO '${build.snapshot.replaceAll("'", "''")}'`);
		}

		for (const [id, e] of legacyIds(db, "timelines", result.runId)) {
			const stored = cachedBreakdown(
				(
					db
						.prepare("SELECT breakdown FROM timelines WHERE id = ?")
						.get(id) as { breakdown: string | null }
				).breakdown,
			);
			const recomputed = JSON.parse(
				JSON.stringify(recomputeBreakdown(db, id, result.runId)),
			);
			const diffs = differences(stored.breakdown, recomputed);
			out.breakdowns.push({
				timeline: e.id,
				same: diffs.length === 0,
				differences: diffs,
				oldShape: stored.oldShape,
			});
		}

		const signingIds = new Map(
			[...legacyIds(db, "signatures", result.runId)].map(([id, e]) => [
				e.id,
				id,
			]),
		);
		for (const s of plan.signatures) {
			out.exports.push(
				compareExport(
					db,
					tables,
					signingIds,
					s.legacyId,
					s.kind,
					s.version,
					factOf(s.signed.path),
					s.signed.sha256,
				),
			);
		}

		if (opts.exifReader) {
			say("  reading technical values with ExifTool");
			await extractProject(project, machine, { readers: [opts.exifReader] });
			const own = new Map<string, string>();
			for (const a of plan.assets) {
				const f = factOf(a.file.path);
				const sha = f.found ? f.sha256 : a.file.sha256;
				if (sha) own.set(a.ref, sha);
			}
			out.technical = compareTechnical(db, tables, own);
		}

		say("  scanning the roots");
		const scan = await scanProject(project, machine);
		const added = db
			.prepare(
				`SELECT r.name || '/' || l.path AS p FROM locations l JOIN roots r ON r.id = l.root_id
				 WHERE l.first_seen_run_id = ? ORDER BY p`,
			)
			.all(scan.runId) as Array<{ p: string }>;
		out.scan = {
			unchanged: scan.counts.unchanged,
			added: scan.counts.added,
			gone: scan.counts.gone,
			addedFiles: added.map((r) => r.p),
		};
	} catch (err) {
		out.error = (err as Error).message;
	} finally {
		db.close();
		out.ok =
			out.error === null &&
			out.plan.blocking.length === 0 &&
			out.problems.length === 0 &&
			out.written !== null &&
			out.verify.length === 0 &&
			out.breakdowns.every((b) => b.same) &&
			out.exports.every((e) => e.same) &&
			out.scan !== null &&
			out.scan.gone === 0 &&
			out.scan.unchanged === (out.written.locations ?? 0);
	}
	return build;
}

async function findFile(
	p: string,
	roots: RootView[],
	platform: NodeJS.Platform,
): Promise<{ fact: FileFact; check: FileCheck }> {
	const abs = path.resolve(p);
	if (!existsSync(abs))
		return {
			fact: { found: false, reason: "missing" },
			check: { path: p, found: false, reason: "missing" },
		};
	// As the filesystem spells it, through links, so the catalog path is the file's own.
	const real = realpathSync.native(abs);
	const root = roots.find(
		(r) => r.folder !== null && isWithin(r.folder, real, platform),
	);
	const rel = root ? toCatalogPath(root.folder!, real, platform) : null;
	if (!root || rel === null)
		return {
			fact: { found: false, reason: "outside every root" },
			check: { path: p, found: false, reason: "outside every root" },
		};
	const stats = statSync(real);
	const sha256 = await sha256OfFile(real);
	return {
		fact: {
			found: true,
			rootId: root.id,
			path: rel,
			sha256,
			size: stats.size,
			modifiedMs: Math.floor(stats.mtimeMs),
		},
		check: { path: p, found: true, root: root.name, catalogPath: rel },
	};
}

/**
 * The public export of one signing, built the way the app builds it from
 * its Postgres row and from the catalog's record: byte for byte the same,
 * or where they differ.
 */
function compareExport(
	db: DatabaseSync,
	tables: Map<string, CopyTable>,
	/** Postgres signing id → catalog id, from the run's record of origins. */
	catalogIdOf: Map<number, number>,
	legacyId: number,
	kind: string,
	version: number,
	signed: FileFact,
	plannedSha: string | null,
): ProjectDryRun["exports"][number] {
	const row = tables
		.get("public.signatures")!
		.rows.find((r) => Number(r.id) === legacyId)!;
	const sha = signed.found ? signed.sha256 : plannedSha;
	const catalogRow = db
		.prepare(
			"SELECT id FROM signatures WHERE kind = ? AND version = ? AND signed_sha256 = ?",
		)
		.get(kind, version, sha) as { id: number } | undefined;
	// The same row, found the other way: from the run's record of origins.
	if (catalogRow && catalogIdOf.get(legacyId) !== catalogRow.id)
		return {
			signature: legacyId,
			same: false,
			differences: ["the run's record of origins points at another signing"],
		};
	if (!catalogRow)
		return {
			signature: legacyId,
			same: false,
			differences: ["the catalog has no such signing"],
		};
	const fromPostgres = appSignature(row);
	const fromCatalog = signatureForExport(db, catalogRow.id);
	const build = (s: object) => {
		try {
			return {
				ok: true,
				json: JSON.stringify(
					buildPublicExportV1({ signature: s, ...EXPORT_STAMP }),
				),
			};
		} catch (err) {
			return { ok: false, json: (err as Error).message };
		}
	};
	const a = build(fromPostgres);
	const b = build(fromCatalog);
	if (a.json === b.json)
		return {
			signature: legacyId,
			same: true,
			differences: [],
			...(a.ok ? {} : { note: `both refuse: ${a.json}` }),
		};
	return {
		signature: legacyId,
		same: false,
		differences:
			a.ok && b.ok
				? differences(JSON.parse(a.json), JSON.parse(b.json))
				: [`Postgres: ${a.json}`, `catalog: ${b.json}`],
	};
}

/** A signatures row as the app's database layer returned it (camelCase, numbers, a time). */
function appSignature(row: CopyRow) {
	return {
		kind: row.kind,
		version: pgInteger(row.version),
		statementJson: row.statement_json,
		reportJson: row.report_json,
		signedPath: row.signed_path,
		signedHash: row.signed_hash,
		signedSize: pgInteger(row.signed_size),
		createdAt: row.created_at === null ? null : pgTimestamp(row.created_at),
	};
}

const near = (a: number, b: number, within: number) =>
	Math.abs(a - b) <= within;

/**
 * Technical values Postgres kept for produced assets against the catalog's
 * technical view, from a fresh ExifTool reading of each asset's own file. A
 * value Postgres did not record (null, 0, empty) is not compared.
 */
function compareTechnical(
	db: DatabaseSync,
	tables: Map<string, CopyTable>,
	ownFile: Map<string, string>,
): { compared: number; differences: string[] } {
	const read = db.prepare(
		"SELECT duration_seconds, frame_rate, width, height, video_codec, audio_codec FROM technical WHERE content_sha256 = ?",
	);
	const out: string[] = [];
	let compared = 0;
	const shown = (v: unknown) =>
		v === null || v === undefined ? "nothing" : String(v);
	for (const pg of tables.get("public.produced_assets")!.rows) {
		const ref = `produced:${pg.id}`;
		const sha = ownFile.get(ref);
		if (!sha) continue;
		const t = read.get(sha) as Record<string, unknown> | undefined;
		if (!t) {
			out.push(`${ref}: no ExifTool reading of its file`);
			continue;
		}
		compared++;
		const numbers: Array<[string, number | null, number]> = [
			["duration_seconds", pgReal(pg.duration_seconds), 0.002],
			["frame_rate", pgReal(pg.frame_rate), 0.002],
			["width", pgInteger(pg.width), 0],
			["height", pgInteger(pg.height), 0],
		];
		for (const [col, was, within] of numbers) {
			if (was === null || was === 0) continue;
			const now = t[col];
			if (typeof now !== "number" || !near(was, now, within))
				out.push(`${ref} ${col}: Postgres ${was}, ExifTool now ${shown(now)}`);
		}
		for (const col of ["video_codec", "audio_codec"]) {
			const was = pg[col];
			if (was && String(t[col] ?? "") !== was)
				out.push(
					`${ref} ${col}: Postgres ${was}, ExifTool now ${shown(t[col])}`,
				);
		}
	}
	return { compared, differences: out };
}
