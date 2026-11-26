// A project is a folder; its catalog is .provenancetracker/catalog.sqlite
// inside it (D26). This module makes and opens catalogs on disk: the one
// place a catalog file is created, put in WAL mode, or copied before an
// upgrade. The SQL itself is core's.

import { randomUUID } from "node:crypto";
import {
	constants,
	copyFileSync,
	existsSync,
	linkSync,
	mkdirSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCatalog } from "@provenancetracker/core/catalog/create.ts";
import {
	CATALOG_FORMAT,
	inspectCatalog,
	refusalMessage,
	type CatalogState,
} from "@provenancetracker/core/catalog/format.ts";
import { isFullPath } from "@provenancetracker/core/catalog/paths.ts";
import {
	upgradeCatalog,
	type UpgradeStep,
} from "@provenancetracker/core/catalog/upgrade.ts";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import { openCatalogFile, structureRefusal } from "./catalog-file.ts";
import type { Machine } from "./machine.ts";
import { projectEntry, readSettings, updateSettings } from "./settings.ts";
import { findSyncFolder, type SyncFolder } from "./sync-folders.ts";
import { TOOL } from "./tool.ts";

export const PROJECT_DIR = ".provenancetracker";
export const CATALOG_FILE = "catalog.sqlite";
export const BACKUP_DIR = "backups";
export const GITIGNORE_FILE = ".gitignore";
/** Imported timeline files, each named by its SHA-256 (the catalog's timelines.file_sha256). */
export const TIMELINES_DIR = "timelines";

/**
 * What init writes to .provenancetracker/.gitignore: the catalog changes
 * with every scan and git would hold it as an opaque blob, so a project
 * folder that is also a git repository keeps it out without any change to
 * the repository's own .gitignore. It travels with the folder instead.
 */
export const GITIGNORE_TEXT =
	"# Written by provenancetracker. The catalog is kept with the project\n" +
	"# folder and its backups, not in git.\n" +
	"*\n";

export function catalogPathOf(folder: string): string {
	return path.join(folder, PROJECT_DIR, CATALOG_FILE);
}

export interface OpenProject {
	db: DatabaseSync;
	/** The project folder, as the filesystem spells it. */
	folder: string;
	catalogPath: string;
	projectId: string;
	name: string;
	/** Upgrades applied while opening, with where the copy beforehand went. */
	upgraded: { from: number; to: number; backup: string } | null;
}

function syncRefusal(folder: string, sync: SyncFolder): Error {
	return new Error(
		`${folder} is inside ${sync.service} (${sync.folder}, found from ${sync.evidence}). ` +
			"A sync client can corrupt a catalog while it is being written, so a project folder must be outside it. " +
			"Keep the project folder on a local drive; media roots may stay in the synced folder.",
	);
}

function fullFolder(folder: string, machine: Machine): string {
	if (!isFullPath(folder, machine.platform))
		throw new Error(`A project folder must be a full path (it is ${folder})`);
	return path.resolve(folder);
}

function isoNow(): string {
	return new Date().toISOString();
}

/**
 * Where a folder really is, through links and junctions, as the filesystem
 * spells it. The folder need not exist yet: its nearest existing parent is
 * resolved and the rest added back.
 */
export function realFolder(folder: string): string {
	const rest: string[] = [];
	for (let dir = path.resolve(folder); ; dir = path.dirname(dir)) {
		if (existsSync(dir))
			return path.join(realpathSync.native(dir), ...rest.reverse());
		if (path.dirname(dir) === dir) return path.resolve(folder);
		rest.push(path.basename(dir));
	}
}

/** Put a finished file at `dest` only if nothing is there, never replacing one. */
export function placeWithoutReplacing(source: string, dest: string): void {
	try {
		linkSync(source, dest);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EEXIST") throw err;
		// Some drives (exFAT, for one) have no hard links; copying refuses an
		// existing file just the same.
		copyFileSync(source, dest, constants.COPYFILE_EXCL);
	}
}

/**
 * Where a new project's catalog goes, checked: a full path, through any link
 * or junction to where the folder really is (so a link into a synced folder
 * is caught too), not inside a sync client's folder, not a file, and with no
 * catalog already. Nothing is made.
 */
export function newProjectFolder(
	folderIn: string,
	machine: Machine,
): { folder: string; catalogPath: string } {
	const folder = realFolder(fullFolder(folderIn, machine));
	const sync = findSyncFolder(folder, machine);
	if (sync) throw syncRefusal(folder, sync);
	if (existsSync(folder) && !statSync(folder).isDirectory())
		throw new Error(`${folder} is a file, not a folder`);
	const catalogPath = catalogPathOf(folder);
	if (existsSync(catalogPath))
		throw new Error(
			`${folder} already has a catalog (${catalogPath}). Nothing was changed.`,
		);
	return { folder, catalogPath };
}

/**
 * Put a new catalog in place: `write` makes it under a temporary name beside
 * where it goes; it must pass verifyCatalog; it then appears at its real name
 * whole, never replacing a catalog already there. Then the folder's
 * .gitignore (one already there is left alone) and this machine's settings
 * entry for the project.
 */
export function placeNewCatalog(
	target: { folder: string; catalogPath: string },
	projectId: string,
	machine: Machine,
	write: (temp: string) => void,
): void {
	const { folder, catalogPath } = target;
	mkdirSync(path.dirname(catalogPath), { recursive: true });
	const temp = `${catalogPath}.${projectId.slice(0, 8)}.new`;
	try {
		write(temp);
		const db = openCatalogFile(temp);
		try {
			const problems = verifyCatalog(db);
			if (problems.length)
				throw new Error(
					`The new catalog failed its own check: ${problems[0].detail}`,
				);
		} finally {
			db.close();
		}
		try {
			placeWithoutReplacing(temp, catalogPath);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EEXIST")
				throw new Error(
					`${folder} already has a catalog (${catalogPath}). Nothing was changed.`,
					{ cause: err },
				);
			throw err;
		}
	} finally {
		rmSync(temp, { force: true });
	}
	try {
		writeFileSync(
			path.join(path.dirname(catalogPath), GITIGNORE_FILE),
			GITIGNORE_TEXT,
			{ flag: "wx" },
		);
	} catch (err) {
		// One already there is someone's own; it is left as it is.
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
	}
	updateSettings(machine.settingsPath, (s) => {
		projectEntry(s, projectId).folder = folder;
	});
}

/**
 * Make a new project in `folder`: an empty catalog with the project's id
 * and name, registered in this machine's settings. The catalog is built
 * under a temporary name and only appears at its real name once complete.
 */
export function createProject(
	folderIn: string,
	opts: { name: string; machine: Machine; now?: string },
): { projectId: string; folder: string; catalogPath: string } {
	const { machine } = opts;
	const now = opts.now ?? isoNow();
	if (!opts.name.trim()) throw new Error("A project needs a name");
	const target = newProjectFolder(folderIn, machine);
	const projectId = randomUUID();
	placeNewCatalog(target, projectId, machine, (temp) => {
		const db = new DatabaseSync(temp);
		try {
			createCatalog(db, { projectId, name: opts.name, tool: TOOL, now });
		} finally {
			db.close();
		}
	});
	return { projectId, ...target };
}
/**
 * The project folder holding `start`, looking in `start` and then each
 * folder above it, as git finds a repository. Null when there is none.
 */
export function findProjectFolder(start: string): string | null {
	for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
		if (existsSync(catalogPathOf(dir))) return dir;
		if (path.dirname(dir) === dir) return null;
	}
}

/**
 * Copy the catalog as it is to .provenancetracker/backups/, and check the
 * copy opens and passes SQLite's integrity check before anything changes.
 * @returns the copy's path relative to .provenancetracker
 */
export function backupCatalog(
	db: DatabaseSync,
	catalogPath: string,
	format: number,
	now: string,
): string {
	const dir = path.join(path.dirname(catalogPath), BACKUP_DIR);
	mkdirSync(dir, { recursive: true });
	const stamp = now.replace(/[:.]/g, "-");
	const name = `catalog.format-${format}.${stamp}.sqlite`;
	const dest = path.join(dir, name);
	// VACUUM INTO writes a consistent copy from a live connection, WAL
	// included, and refuses to overwrite an existing file.
	db.prepare("VACUUM INTO ?").run(dest);
	const copy = openCatalogFile(dest, { readOnly: true });
	try {
		const check = copy.prepare("PRAGMA integrity_check").get() as {
			integrity_check: string;
		};
		const state = inspectCatalog(copy);
		if (
			check.integrity_check !== "ok" ||
			!("format" in state) ||
			state.format !== format
		)
			throw new Error(
				`The copy at ${dest} did not check out (${check.integrity_check}); the catalog was not upgraded`,
			);
	} finally {
		copy.close();
	}
	return `${BACKUP_DIR}/${name}`;
}

/**
 * A folder with no catalog in it. The message states only that; each front
 * end adds its own way to make one (the command line's init, the app's form).
 */
export class NoCatalogError extends Error {
	folder: string;
	constructor(folder: string) {
		super(`There is no catalog in ${folder}.`);
		this.name = "NoCatalogError";
		this.folder = folder;
	}
}

/**
 * A catalog with the id of a project this machine already has at another
 * folder, where that project's catalog still is (D68). The id is all that
 * ties a catalog to this machine's signing certificate, identity and media
 * folders, so a second folder with the same id is not given them unasked: it
 * may be a copy someone altered and handed back. Opening it with `takeOver`
 * moves them to it. The message states only what was found; each front end
 * adds its own way to go on (the command line's --take-over, the app's
 * button).
 */
export class ProjectElsewhereError extends Error {
	projectId: string;
	/** Where this machine has the project now. */
	known: string;
	/** The folder that was asked for. */
	folder: string;
	constructor(projectId: string, known: string, folder: string) {
		super(
			`This catalog says it is a project this machine already has at ${known}, and that folder still holds its catalog. A project's signing set-up, identity and media folders on this machine go with its id, so they are not handed to a second copy unasked. Nothing was changed.`,
		);
		this.name = "ProjectElsewhereError";
		this.projectId = projectId;
		this.known = known;
		this.folder = folder;
	}
}

/** Whether a folder still holds the catalog of the project with this id. Reads only. */
function stillHolds(folder: string, projectId: string): boolean {
	const catalogPath = catalogPathOf(folder);
	if (!existsSync(catalogPath)) return false;
	let db: DatabaseSync | null = null;
	try {
		db = openCatalogFile(catalogPath, { readOnly: true });
		const state = inspectCatalog(db);
		if (!("format" in state) || structureRefusal(db, state.format))
			return false;
		const row = db
			.prepare("SELECT value FROM meta WHERE key = 'project_id'")
			.get() as { value: string } | undefined;
		return row?.value === projectId;
	} catch {
		return false;
	} finally {
		db?.close();
	}
}

/**
 * Open the project in `folder`. Refuses a folder inside a sync folder, a
 * file that is not a catalog, a catalog newer than this tracker, one whose
 * structure is not its format's, and (unless `takeOver`) one with the id of
 * a project this machine has elsewhere. An older catalog is copied to
 * backups/ and then upgraded.
 */
export function openProject(
	folderIn: string,
	opts: {
		machine: Machine;
		now?: string;
		/**
		 * This folder is where the project lives now: move this machine's
		 * signing set-up, identity and media folders for its id here, though the
		 * folder it was at still holds a catalog with that id.
		 */
		takeOver?: boolean;
		/** For tests: upgrade steps and the format to reach. */
		upgrade?: { steps: readonly UpgradeStep[]; target: number };
	},
): OpenProject {
	const { machine } = opts;
	const given = fullFolder(folderIn, machine);
	if (!existsSync(catalogPathOf(given))) throw new NoCatalogError(given);
	const folder = realpathSync.native(given);
	const catalogPath = catalogPathOf(folder);
	const sync = findSyncFolder(folder, machine);
	if (sync) throw syncRefusal(folder, sync);

	// readOnly first: it never creates a file, and inspecting changes nothing.
	// It also matters for safety: opened for writing, SQLite acts on a journal
	// file beside the catalog before anything can be checked. Everything that
	// decides whether to open is read here, and nothing in the catalog runs.
	const look = openCatalogFile(catalogPath, { readOnly: true });
	let state: CatalogState;
	let structure: string | null = null;
	let lookId: string | undefined;
	try {
		state = inspectCatalog(look);
		if ("format" in state && !refusalMessage(state)) {
			structure = structureRefusal(look, state.format);
			if (!structure)
				lookId = (
					look
						.prepare("SELECT value FROM meta WHERE key = 'project_id'")
						.get() as { value: string } | undefined
				)?.value;
		}
	} finally {
		look.close();
	}
	if (state.state === "empty")
		throw new Error(
			`${catalogPath} is an empty file, not a catalog. Nothing was changed.`,
		);
	const refusal = refusalMessage(state) ?? structure;
	if (refusal) throw new Error(`${catalogPath}: ${refusal}`);
	// This machine's settings are read before anything is written, so a
	// damaged settings file stops the open before an upgrade changes the catalog.
	const settings = readSettings(machine.settingsPath);
	// A project this machine has at another folder, whose catalog is still
	// there, does not hand its set-up to this one unasked.
	const known = lookId ? settings.projects[lookId]?.folder : undefined;
	if (
		lookId &&
		known &&
		known !== folder &&
		!opts.takeOver &&
		stillHolds(known, lookId)
	)
		throw new ProjectElsewhereError(lookId, known, folder);

	const db = openCatalogFile(catalogPath);
	try {
		db.exec("PRAGMA busy_timeout = 5000");
		db.exec("PRAGMA journal_mode = WAL");
		const target = opts.upgrade?.target ?? CATALOG_FORMAT;
		let upgraded: OpenProject["upgraded"] = null;
		if ("format" in state && state.format < target) {
			const now = opts.now ?? isoNow();
			const backup = backupCatalog(db, catalogPath, state.format, now);
			const steps = upgradeCatalog(db, {
				backup,
				tool: TOOL,
				now,
				...(opts.upgrade ?? {}),
			});
			upgraded = {
				from: state.format,
				to: steps.at(-1)?.to ?? state.format,
				backup,
			};
		}
		const meta = (key: string) =>
			(
				db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
					{ value: string } | undefined
			)?.value;
		const projectId = meta("project_id");
		const name = meta("name");
		if (!projectId || !name)
			throw new Error(
				`${catalogPath} has no project id or name; run verify on it`,
			);
		if (settings.projects[projectId]?.folder !== folder)
			updateSettings(machine.settingsPath, (s) => {
				projectEntry(s, projectId).folder = folder;
			});
		return { db, folder, catalogPath, projectId, name, upgraded };
	} catch (err) {
		db.close();
		throw err;
	}
}
