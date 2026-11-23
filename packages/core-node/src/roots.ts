// A project's media roots, named in the catalog. A root inside the project
// folder is placed in the catalog too, relative to the project folder, so the
// project finds it wherever the folder is copied, archived or restored. A
// root outside the project folder is placed in this machine's settings, since
// that path means nothing on another machine; locating one there writes only
// the settings.

import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
	createRow,
	editRow,
	type Actor,
} from "@provenancetracker/core/catalog/edit.ts";
import {
	fromCatalogPath,
	isFullPath,
	isWithin,
	overlaps,
	toCatalogPath,
} from "@provenancetracker/core/catalog/paths.ts";
import type { Machine } from "./machine.ts";
import { PROJECT_DIR, type OpenProject } from "./project.ts";
import { projectEntry, readSettings, updateSettings } from "./settings.ts";
import { findSyncFolder } from "./sync-folders.ts";

export interface RootView {
	id: number;
	name: string;
	note: string;
	/** Its folder on this machine, or null when this machine has none. */
	folder: string | null;
	/**
	 * True when the root is inside the project folder and found from it, so
	 * it travels with the folder; false when this machine's settings place it.
	 */
	inProject: boolean;
	status: "ok" | "not located on this machine" | "folder missing";
	/** Why scanning this root may be slow or surprising. */
	warnings: string[];
}

interface RootRow {
	id: number;
	name: string;
	note: string;
	folder_in_project: string | null;
}

const ROOT_COLUMNS = "id, name, note, folder_in_project";

function rootRows(project: OpenProject): RootRow[] {
	return project.db
		.prepare(`SELECT ${ROOT_COLUMNS} FROM roots ORDER BY id`)
		.all() as unknown as RootRow[];
}

function rootByName(project: OpenProject, name: string): RootRow {
	const row = project.db
		.prepare(`SELECT ${ROOT_COLUMNS} FROM roots WHERE name = ?`)
		.get(name) as RootRow | undefined;
	if (!row) {
		const names = rootRows(project).map((r) => r.name);
		throw new Error(
			`This project has no root called "${name}"` +
				(names.length
					? ` (it has: ${names.join(", ")})`
					: " (it has none yet)"),
		);
	}
	return row;
}

function placedHere(
	project: OpenProject,
	machine: Machine,
): Record<string, string> {
	return (
		readSettings(machine.settingsPath).projects[project.projectId]?.roots ?? {}
	);
}

/**
 * Where a root is on this machine. A root inside the project folder is
 * found from the project folder alone; a settings entry left over for it
 * (from before the project moved, say) is ignored, so it can never lead to
 * an old copy of the folder.
 */
function folderOf(
	project: OpenProject,
	machine: Machine,
	row: RootRow,
	placed: Record<string, string>,
): string | null {
	if (row.folder_in_project === ".") return project.folder;
	if (row.folder_in_project !== null)
		return fromCatalogPath(
			project.folder,
			row.folder_in_project,
			machine.platform,
		);
	return placed[String(row.id)] ?? null;
}

/** A folder's place relative to the project folder, or null when it is outside it. */
function inProjectPlace(
	project: OpenProject,
	machine: Machine,
	folder: string,
): string | null {
	if (!isWithin(project.folder, folder, machine.platform)) return null;
	if (isWithin(folder, project.folder, machine.platform)) return ".";
	return toCatalogPath(project.folder, folder, machine.platform);
}

function syncWarnings(folder: string, machine: Machine): string[] {
	const sync = findSyncFolder(folder, machine);
	if (!sync) return [];
	return [
		`${folder} is inside ${sync.service} (${sync.folder}). Files kept online only are downloaded in full when they are scanned.`,
	];
}

/** Check a folder can be a root of this project here; return it as the filesystem spells it. */
function checkFolder(
	project: OpenProject,
	machine: Machine,
	folderIn: string,
	except?: number,
): string {
	if (!isFullPath(folderIn, machine.platform))
		throw new Error(`A root's folder must be a full path (it is ${folderIn})`);
	if (!existsSync(folderIn))
		throw new Error(`There is no folder at ${folderIn}`);
	if (!statSync(folderIn).isDirectory())
		throw new Error(`${folderIn} is a file, not a folder`);
	const folder = realpathSync.native(folderIn);
	const own = path.join(project.folder, PROJECT_DIR);
	if (isWithin(own, folder, machine.platform))
		throw new Error(
			`${folder} is inside the project's own ${PROJECT_DIR} folder`,
		);
	const placed = placedHere(project, machine);
	for (const row of rootRows(project)) {
		if (row.id === except) continue;
		const other = folderOf(project, machine, row, placed);
		if (other === null) continue;
		if (
			isWithin(other, folder, machine.platform) &&
			isWithin(folder, other, machine.platform)
		)
			throw new Error(
				`${folder} is already the folder of the root "${row.name}"`,
			);
		if (overlaps(other, folder, machine.platform))
			throw new Error(
				`${folder} overlaps the root "${row.name}" (${other}). ` +
					"Every file must belong to one root, so roots cannot be inside one another.",
			);
	}
	return folder;
}

function viewOf(
	row: RootRow,
	folder: string | null,
	machine: Machine,
): RootView {
	const base = {
		id: row.id,
		name: row.name,
		note: row.note,
		folder,
		inProject: row.folder_in_project !== null,
	};
	if (folder === null)
		return { ...base, status: "not located on this machine", warnings: [] };
	if (!existsSync(folder) || !statSync(folder).isDirectory())
		return { ...base, status: "folder missing", warnings: [] };
	return { ...base, status: "ok", warnings: syncWarnings(folder, machine) };
}

/** The project's roots, and where each is on this machine. */
export function listRoots(project: OpenProject, machine: Machine): RootView[] {
	const placed = placedHere(project, machine);
	return rootRows(project).map((row) =>
		viewOf(row, folderOf(project, machine, row, placed), machine),
	);
}

/** Write (or, with null, remove) this machine's place for a root. */
function placeOnThisMachine(
	project: OpenProject,
	machine: Machine,
	id: number,
	folder: string | null,
): void {
	const key = String(id);
	const current = placedHere(project, machine)[key] ?? null;
	if (current === folder) return;
	updateSettings(machine.settingsPath, (s) => {
		const roots = projectEntry(s, project.projectId).roots;
		if (folder === null) delete roots[key];
		else roots[key] = folder;
	});
}

/**
 * Add a root to the catalog. A folder inside the project folder is recorded
 * relative to it; any other folder is placed on this machine.
 */
export function addRoot(
	project: OpenProject,
	machine: Machine,
	opts: {
		name: string;
		folder: string;
		note?: string;
		actor: Actor;
		now?: string;
	},
): RootView {
	const name = opts.name.trim();
	if (!name) throw new Error("A root needs a name");
	const taken = project.db
		.prepare("SELECT 1 FROM roots WHERE name = ?")
		.get(name);
	if (taken)
		throw new Error(`This project already has a root called "${name}"`);
	const folder = checkFolder(project, machine, opts.folder);
	const place = inProjectPlace(project, machine, folder);
	const note = opts.note ?? "";
	const id = Number(
		createRow(
			project.db,
			"roots",
			place === null
				? { name, note }
				: { name, note, folder_in_project: place },
			{ actor: opts.actor, now: opts.now },
		),
	);
	if (place === null) placeOnThisMachine(project, machine, id, folder);
	return viewOf({ id, name, note, folder_in_project: place }, folder, machine);
}

/**
 * Say where an existing root is. A folder outside the project folder changes
 * only this machine's settings. A folder inside it is recorded in the catalog
 * (relative to the project folder), which every copy of the project then
 * follows, so that change is made under `actor` and kept in the history.
 */
export function locateRoot(
	project: OpenProject,
	machine: Machine,
	opts: { name: string; folder: string; actor: () => Actor; now?: string },
): RootView {
	const row = rootByName(project, opts.name);
	const folder = checkFolder(project, machine, opts.folder, row.id);
	const place = inProjectPlace(project, machine, folder);
	if (place !== row.folder_in_project)
		editRow(
			project.db,
			"roots",
			row.id,
			{ folder_in_project: place },
			{ actor: opts.actor(), now: opts.now },
		);
	placeOnThisMachine(project, machine, row.id, place === null ? folder : null);
	return viewOf({ ...row, folder_in_project: place }, folder, machine);
}

/** Rename a root. Its files and its place on every machine stay as they are. */
export function renameRoot(
	project: OpenProject,
	opts: { name: string; newName: string; actor: Actor; now?: string },
): void {
	const row = rootByName(project, opts.name);
	const newName = opts.newName.trim();
	if (!newName) throw new Error("A root needs a name");
	if (
		newName !== row.name &&
		project.db.prepare("SELECT 1 FROM roots WHERE name = ?").get(newName)
	)
		throw new Error(`This project already has a root called "${newName}"`);
	editRow(
		project.db,
		"roots",
		row.id,
		{ name: newName },
		{ actor: opts.actor, now: opts.now },
	);
}
