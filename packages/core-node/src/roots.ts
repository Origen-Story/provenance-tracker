// A project's media roots: named in the catalog (which travels), placed in
// this machine's settings (which does not). Adding a root writes both;
// locating one on a new machine writes only the settings.

import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
	createRow,
	editRow,
	type Actor,
} from "@provenancetracker/core/catalog/edit.ts";
import {
	isFullPath,
	isWithin,
	overlaps,
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
	status: "ok" | "not located on this machine" | "folder missing";
	/** Why scanning this root may be slow or surprising. */
	warnings: string[];
}

interface RootRow {
	id: number;
	name: string;
	note: string;
}

function rootRows(project: OpenProject): RootRow[] {
	return project.db
		.prepare("SELECT id, name, note FROM roots ORDER BY id")
		.all() as unknown as RootRow[];
}

function rootByName(project: OpenProject, name: string): RootRow {
	const row = project.db
		.prepare("SELECT id, name, note FROM roots WHERE name = ?")
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
	const placed =
		readSettings(machine.settingsPath).projects[project.projectId]?.roots ?? {};
	const names = new Map(rootRows(project).map((r) => [r.id, r.name]));
	for (const [id, other] of Object.entries(placed)) {
		if (Number(id) === except || !names.has(Number(id))) continue;
		if (
			isWithin(other, folder, machine.platform) &&
			isWithin(folder, other, machine.platform)
		)
			throw new Error(
				`${folder} is already the folder of the root "${names.get(Number(id))}"`,
			);
		if (overlaps(other, folder, machine.platform))
			throw new Error(
				`${folder} overlaps the root "${names.get(Number(id))}" (${other}). ` +
					"Every file must belong to one root, so roots cannot be inside one another.",
			);
	}
	return folder;
}

/** The project's roots, and where each is on this machine. */
export function listRoots(project: OpenProject, machine: Machine): RootView[] {
	const placed =
		readSettings(machine.settingsPath).projects[project.projectId]?.roots ?? {};
	return rootRows(project).map((row) => {
		const folder = placed[String(row.id)] ?? null;
		if (folder === null)
			return {
				...row,
				folder,
				status: "not located on this machine",
				warnings: [],
			};
		if (!existsSync(folder) || !statSync(folder).isDirectory())
			return { ...row, folder, status: "folder missing", warnings: [] };
		return {
			...row,
			folder,
			status: "ok",
			warnings: syncWarnings(folder, machine),
		};
	});
}

/** Add a root to the catalog and place it on this machine. */
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
	const id = Number(
		createRow(
			project.db,
			"roots",
			{ name, note: opts.note ?? "" },
			{ actor: opts.actor, now: opts.now },
		),
	);
	updateSettings(machine.settingsPath, (s) => {
		projectEntry(s, project.projectId).roots[String(id)] = folder;
	});
	return {
		id,
		name,
		note: opts.note ?? "",
		folder,
		status: "ok",
		warnings: syncWarnings(folder, machine),
	};
}

/** Say where an existing root is on this machine. Changes only this machine's settings. */
export function locateRoot(
	project: OpenProject,
	machine: Machine,
	opts: { name: string; folder: string },
): RootView {
	const row = rootByName(project, opts.name);
	const folder = checkFolder(project, machine, opts.folder, row.id);
	updateSettings(machine.settingsPath, (s) => {
		projectEntry(s, project.projectId).roots[String(row.id)] = folder;
	});
	return {
		...row,
		folder,
		status: "ok",
		warnings: syncWarnings(folder, machine),
	};
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
