// The projects this machine knows (its settings), and whether each is still
// where it was. Listing reads only: each catalog is opened read-only, so it
// never upgrades, moves or writes anything. Forgetting a project changes this
// machine's settings and nothing in the project.

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
	inspectCatalog,
	refusalMessage,
} from "@provenancetracker/core/catalog/format.ts";
import type { Machine } from "./machine.ts";
import { catalogPathOf } from "./project.ts";
import { isProjectId, readSettings, updateSettings } from "./settings.ts";

export interface KnownProject {
	projectId: string;
	folder: string;
	/** The project's name, from its catalog; null when the catalog cannot be read. */
	name: string | null;
	status:
		"ok" | "folder missing" | "no catalog" | "not readable" | "another project";
	/** Why, when the status is not ok. */
	detail?: string;
}

export function knownProjects(machine: Machine): KnownProject[] {
	const settings = readSettings(machine.settingsPath);
	const out: KnownProject[] = [];
	for (const [projectId, entry] of Object.entries(settings.projects)) {
		const folder = entry.folder;
		if (!folder) continue;
		const base = { projectId, folder, name: null };
		if (!existsSync(folder)) {
			out.push({ ...base, status: "folder missing" });
			continue;
		}
		const catalogPath = catalogPathOf(folder);
		if (!existsSync(catalogPath)) {
			out.push({ ...base, status: "no catalog" });
			continue;
		}
		let db: DatabaseSync | null = null;
		try {
			db = new DatabaseSync(catalogPath, { readOnly: true });
			const refusal = refusalMessage(inspectCatalog(db));
			if (refusal) {
				out.push({ ...base, status: "not readable", detail: refusal });
				continue;
			}
			const meta = db.prepare("SELECT value FROM meta WHERE key = ?");
			const id = (meta.get("project_id") as { value: string } | undefined)
				?.value;
			const name =
				(meta.get("name") as { value: string } | undefined)?.value ?? null;
			out.push(
				id === projectId
					? { ...base, name, status: "ok" }
					: {
							...base,
							name,
							status: "another project",
							detail: `The folder now holds project ${id ?? "(no id)"}`,
						},
			);
		} catch (err) {
			out.push({
				...base,
				status: "not readable",
				detail: (err as Error).message,
			});
		} finally {
			db?.close();
		}
	}
	return out.sort((a, b) =>
		(a.name ?? a.folder).localeCompare(b.name ?? b.folder),
	);
}

/**
 * Forget a project on this machine: its folder, where its media folders are
 * here and its signing files are dropped from this machine's settings. The
 * project folder, its catalog and its media are not touched; opening the
 * folder again brings the project back, and media folders outside it are
 * located again.
 * @returns whether this machine knew the project
 */
export function forgetProject(machine: Machine, projectId: string): boolean {
	// Only a project id is ever a key (settings.ts), so "__proto__" is simply not known.
	if (!isProjectId(projectId)) return false;
	if (!Object.hasOwn(readSettings(machine.settingsPath).projects, projectId))
		return false;
	updateSettings(machine.settingsPath, (s) => {
		delete s.projects[projectId];
	});
	return true;
}
