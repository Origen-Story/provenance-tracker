// Files the tracker adds to a root: an upload, a download. Each arrives in
// the project's own .provenancetracker/incoming folder (on the project's
// drive, so moving it is usually a rename), and is then given a free name in
// the folder asked for, inside a root, never replacing a file already there.
// A scan then records it like any other file.

import {
	constants,
	existsSync,
	linkSync,
	mkdirSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import {
	fromCatalogPath,
	isCatalogPath,
	isWithin,
	toCatalogPath,
} from "@provenancetracker/core/catalog/paths.ts";
import { freeName, safeFileName } from "@provenancetracker/core/files/names.ts";
import type { Machine } from "./machine.ts";
import { PROJECT_DIR, type OpenProject } from "./project.ts";
import { listRoots } from "./roots.ts";

export const INCOMING_DIR = "incoming";

/** Where files arrive before they are placed: inside the project's own folder. */
export function incomingFolder(projectFolder: string): string {
	const dir = path.join(projectFolder, PROJECT_DIR, INCOMING_DIR);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** A folder inside a root on this machine, named by the root and a catalog path. */
export interface Target {
	root: string;
	rootFolder: string;
	/** "" for the root's own folder, else a catalog path inside it. */
	subfolder: string;
	folder: string;
}

/**
 * The folder files go into: a root located on this machine, and optionally
 * a folder inside it, given as a catalog path ("day 1/cards"). It can never
 * lead outside the root. The folder is made if it is not there.
 */
export function targetFolder(
	project: OpenProject,
	machine: Machine,
	rootName: string,
	subfolder = "",
): Target {
	const root = listRoots(project, machine).find((r) => r.name === rootName);
	if (!root) throw new Error(`This project has no root called "${rootName}"`);
	if (root.status !== "ok" || !root.folder)
		throw new Error(`The root "${rootName}" is ${root.status}`);
	const sub = subfolder.trim();
	if (sub !== "" && !isCatalogPath(sub))
		throw new Error(
			`"${subfolder}" is not a folder inside the root: use / between folders, with no .. or drive`,
		);
	const folder =
		sub === ""
			? root.folder
			: fromCatalogPath(root.folder, sub, machine.platform);
	if (!isWithin(root.folder, folder, machine.platform))
		throw new Error(`"${subfolder}" is not inside the root "${rootName}"`);
	// A media folder may be the project folder, or hold it. The catalog's own
	// folder is still never a place for a file that arrives: a file named as
	// the catalog's journal, put beside it, would be replayed into the catalog
	// the next time it opened, with no history of any of it.
	const own = path.join(project.folder, PROJECT_DIR);
	if (isWithin(own, folder, machine.platform))
		throw new Error(
			`Files are not added inside the project's own ${PROJECT_DIR} folder, which holds its catalog`,
		);
	if (existsSync(folder) && !statSync(folder).isDirectory())
		throw new Error(`${folder} is a file, not a folder`);
	mkdirSync(folder, { recursive: true });
	return { root: root.name, rootFolder: root.folder, subfolder: sub, folder };
}

export interface Placed {
	root: string;
	/** The file's catalog path in its root. */
	path: string;
	file: string;
	/** True when the name asked for was taken, so it got " (2)" or the like. */
	renamed: boolean;
}

/**
 * Move a received file into the target folder under a free form of its name,
 * never replacing a file: a hard link that fails if the name is taken (then
 * the next free name), or, across drives, a copy that refuses an existing
 * file. The received file is removed once it is in place. The copy is not
 * a blocking one: a film of several gigabytes going to another drive would
 * otherwise stop the server answering anything until it was done.
 */
export async function placeFile(
	received: string,
	target: Target,
	offeredName: string,
	machine: Machine,
): Promise<Placed> {
	const wanted = safeFileName(offeredName);
	for (let attempt = 0; attempt < 20; attempt++) {
		const name = freeName(wanted, (n) =>
			existsSync(path.join(target.folder, n)),
		);
		const dest = path.join(target.folder, name);
		try {
			try {
				linkSync(received, dest);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === "EEXIST") throw err;
				// Across drives there are no hard links; a copy that refuses an
				// existing file does the same job.
				await copyFile(received, dest, constants.COPYFILE_EXCL);
			}
		} catch (err) {
			// Someone else took the name between the look and the link: try the next.
			if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw err;
		}
		unlinkSync(received);
		const rel = toCatalogPath(target.rootFolder, dest, machine.platform);
		if (!rel) throw new Error(`${dest} is not a file the catalog can hold`);
		return {
			root: target.root,
			path: rel,
			file: dest,
			renamed: name !== wanted,
		};
	}
	throw new Error(`Could not find a free name for ${wanted}`);
}
