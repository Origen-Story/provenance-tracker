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
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCatalog } from "@provenancetracker/core/catalog/create.ts";
import {
	CATALOG_FORMAT,
	inspectCatalog,
	prepareConnection,
	refusalMessage,
	type CatalogState,
} from "@provenancetracker/core/catalog/format.ts";
import { isFullPath } from "@provenancetracker/core/catalog/paths.ts";
import {
	upgradeCatalog,
	type UpgradeStep,
} from "@provenancetracker/core/catalog/upgrade.ts";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import type { Machine } from "./machine.ts";
import { projectEntry, readSettings, updateSettings } from "./settings.ts";
import { findSyncFolder, type SyncFolder } from "./sync-folders.ts";
import { TOOL } from "./tool.ts";

export const PROJECT_DIR = ".provenancetracker";
export const CATALOG_FILE = "catalog.sqlite";
export const BACKUP_DIR = "backups";

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
function placeWithoutReplacing(source: string, dest: string): void {
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
	// Through any link or junction to where the folder really is, before
	// anything is made, so a link into a synced folder is caught too.
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
	mkdirSync(path.dirname(catalogPath), { recursive: true });

	const projectId = randomUUID();
	const temp = `${catalogPath}.${projectId.slice(0, 8)}.new`;
	try {
		const db = new DatabaseSync(temp);
		try {
			createCatalog(db, { projectId, name: opts.name, tool: TOOL, now });
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
					{
						cause: err,
					},
				);
			throw err;
		}
	} finally {
		rmSync(temp, { force: true });
	}
	updateSettings(machine.settingsPath, (s) => {
		projectEntry(s, projectId).folder = folder;
	});
	return { projectId, folder, catalogPath };
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
	const copy = new DatabaseSync(dest, { readOnly: true });
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
 * Open the project in `folder`. Refuses a folder inside a sync folder, a
 * file that is not a catalog, and a catalog newer than this tracker. An
 * older catalog is copied to backups/ and then upgraded.
 */
export function openProject(
	folderIn: string,
	opts: {
		machine: Machine;
		now?: string;
		/** For tests: upgrade steps and the format to reach. */
		upgrade?: { steps: readonly UpgradeStep[]; target: number };
	},
): OpenProject {
	const { machine } = opts;
	const given = fullFolder(folderIn, machine);
	if (!existsSync(catalogPathOf(given)))
		throw new Error(
			`There is no catalog in ${given}. To make one there: npm run cli -- init "${given}"`,
		);
	const folder = realpathSync.native(given);
	const catalogPath = catalogPathOf(folder);
	const sync = findSyncFolder(folder, machine);
	if (sync) throw syncRefusal(folder, sync);

	// readOnly first: it never creates a file, and inspecting changes nothing.
	const look = new DatabaseSync(catalogPath, { readOnly: true });
	let state: CatalogState;
	try {
		state = inspectCatalog(look);
	} finally {
		look.close();
	}
	if (state.state === "empty")
		throw new Error(
			`${catalogPath} is an empty file, not a catalog. Nothing was changed.`,
		);
	const refusal = refusalMessage(state);
	if (refusal) throw new Error(`${catalogPath}: ${refusal}`);

	const db = new DatabaseSync(catalogPath);
	try {
		prepareConnection(db);
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
		if (
			readSettings(machine.settingsPath).projects[projectId]?.folder !== folder
		)
			updateSettings(machine.settingsPath, (s) => {
				projectEntry(s, projectId).folder = folder;
			});
		return { db, folder, catalogPath, projectId, name, upgraded };
	} catch (err) {
		db.close();
		throw err;
	}
}
