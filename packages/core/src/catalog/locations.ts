// Recording where a content's file is: one way to write a place, so its
// folded path (format 3, D75) is always written with it. SQLite cannot fold
// accents, so nothing in the catalog can do it for a writer that forgets;
// verifyCatalog reports a place whose folded path is not its path's.

import type { DatabaseSync } from "node:sqlite";
import { foldForSearch } from "./fields.ts";

export interface Place {
	sha256: string;
	rootId: number;
	/** The file's path inside its media folder, as the catalog writes paths. */
	path: string;
	modifiedMs: number;
	/** The run that found it there. */
	runId: number;
}

/** A function that records a place; prepared once, for many files. */
export function placeWriter(db: DatabaseSync): (place: Place) => void {
	const insert = db.prepare(
		`INSERT INTO locations (content_sha256, root_id, path, path_folded, modified_ms, first_seen_run_id, last_seen_run_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	return (p) => {
		insert.run(
			p.sha256,
			p.rootId,
			p.path,
			foldForSearch(p.path),
			p.modifiedMs,
			p.runId,
			p.runId,
		);
	};
}

/**
 * What a person typed, as a pattern for LIKE against a folded column: folded
 * the same way, with LIKE's own characters taken literally (ESCAPE '\').
 */
export function foldedLike(q: string): string {
	return `%${foldForSearch(q).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}
