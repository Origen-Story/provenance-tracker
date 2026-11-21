// Is a folder inside a cloud-sync folder? A sync client copies a catalog
// while SQLite is writing it, and can upload half a write or bring back an
// older copy, so a catalog there is refused (D14). Media files are only read,
// so a root there gets a warning: an online-only file is downloaded in full
// when it is hashed.
//
// Two kinds of evidence, both from the sync client itself:
// - where the client says its folder is (OneDrive's environment variables,
//   Dropbox's info.json, macOS's CloudStorage and iCloud folders, iCloud for
//   Windows' folder);
// - a marker the client keeps at the top of its folder (.dropbox,
//   Syncthing's .stfolder, the .shortcut-targets-by-id folder at the root of
//   Google Drive's drive letter).
// Not detected: Google Drive's "mirror files" mode, Box, Nextcloud and other
// clients whose folder is neither announced nor marked (docs/decisions.md D28).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isWithin } from "@provenancetracker/core/catalog/paths.ts";
import type { Machine } from "./machine.ts";

export interface SyncFolder {
	/** The service, in words ("OneDrive", "Google Drive"…). */
	service: string;
	/** The top of the synced folder. */
	folder: string;
	/** How it was found, for the message. */
	evidence: string;
}

const MARKERS: ReadonlyArray<{ name: string; service: string }> = [
	{ name: ".dropbox", service: "Dropbox" },
	{ name: ".stfolder", service: "Syncthing" },
	{ name: ".shortcut-targets-by-id", service: "Google Drive" },
];

function pathsFor(machine: Pick<Machine, "platform">) {
	return machine.platform === "win32" ? path.win32 : path.posix;
}

function dropboxFolders(file: string): string[] {
	try {
		const info = JSON.parse(readFileSync(file, "utf8")) as Record<
			string,
			{ path?: unknown } | undefined
		>;
		return Object.values(info)
			.map((account) => account?.path)
			.filter((p): p is string => typeof p === "string" && p !== "");
	} catch {
		return [];
	}
}

function cloudStorageService(name: string): string {
	const prefix = name.split("-")[0];
	const known: Record<string, string> = {
		GoogleDrive: "Google Drive",
		OneDrive: "OneDrive",
		Dropbox: "Dropbox",
		Box: "Box",
	};
	return known[prefix] ?? name;
}

/** The sync folders this machine's sync clients announce. */
export function knownSyncFolders(
	machine: Pick<Machine, "platform" | "env" | "home">,
): SyncFolder[] {
	const { env, home, platform } = machine;
	const p = pathsFor(machine);
	const found: SyncFolder[] = [];
	for (const name of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
		const folder = env[name];
		if (folder)
			found.push({
				service: "OneDrive",
				folder,
				evidence: `the ${name} environment variable`,
			});
	}
	const dropboxInfo = [
		env.APPDATA && p.join(env.APPDATA, "Dropbox", "info.json"),
		env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, "Dropbox", "info.json"),
		p.join(home, ".dropbox", "info.json"),
	].filter((f): f is string => Boolean(f));
	for (const file of dropboxInfo)
		for (const folder of dropboxFolders(file))
			found.push({ service: "Dropbox", folder, evidence: file });
	if (platform === "darwin") {
		const cloudStorage = p.join(home, "Library", "CloudStorage");
		if (existsSync(cloudStorage))
			for (const name of readdirSync(cloudStorage))
				found.push({
					service: cloudStorageService(name),
					folder: p.join(cloudStorage, name),
					evidence: "macOS's CloudStorage folder",
				});
		found.push({
			service: "iCloud Drive",
			folder: p.join(home, "Library", "Mobile Documents"),
			evidence: "macOS's iCloud folder",
		});
	}
	if (platform === "win32") {
		const icloud = p.join(home, "iCloudDrive");
		if (existsSync(icloud))
			found.push({
				service: "iCloud Drive",
				folder: icloud,
				evidence: "iCloud for Windows' folder",
			});
	}
	return found;
}

/**
 * The sync folder that `target` is in, or null. `target` must be a full
 * path; it need not exist yet (its nearest existing parent is checked).
 */
export function findSyncFolder(
	target: string,
	machine: Pick<Machine, "platform" | "env" | "home">,
): SyncFolder | null {
	const p = pathsFor(machine);
	const full = p.resolve(target);
	for (const known of knownSyncFolders(machine))
		if (isWithin(known.folder, full, machine.platform)) return known;
	for (let dir = full; ; dir = p.dirname(dir)) {
		for (const marker of MARKERS)
			if (existsSync(p.join(dir, marker.name)))
				return {
					service: marker.service,
					folder: dir,
					evidence: `${marker.name} in ${dir}`,
				};
		if (p.dirname(dir) === dir) return null;
	}
}
