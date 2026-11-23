// The projects this machine knows (its settings), and whether each is still
// where it was. Reads only: each catalog is opened read-only, so listing never
// upgrades, moves or writes anything.

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
	inspectCatalog,
	refusalMessage,
} from "@provenancetracker/core/catalog/format.ts";
import type { Machine } from "./machine.ts";
import { catalogPathOf } from "./project.ts";
import { readSettings } from "./settings.ts";

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
