// A run is one scan, extraction, classification, signing, import, upgrade or
// migration. It is opened before its work starts, so what it writes can name
// it, and sealed when it ends; the catalog refuses any change after that.

import type { DatabaseSync } from "node:sqlite";
import type { Tool } from "./create.ts";

export type RunOutcome = "ok" | "failed" | "cancelled";

export function startRun(
	db: DatabaseSync,
	opts: { kind: string; tool: Tool; now?: string },
): number {
	if (!opts.kind.trim()) throw new Error("A run needs a kind");
	const result = db
		.prepare(
			"INSERT INTO runs (kind, tool, tool_version, started_at) VALUES (?, ?, ?, ?)",
		)
		.run(
			opts.kind,
			opts.tool.name,
			opts.tool.version,
			opts.now ?? new Date().toISOString(),
		);
	return Number(result.lastInsertRowid);
}

/** Record how a run ended, and what it found. Once only. */
export function finishRun(
	db: DatabaseSync,
	id: number,
	opts: {
		outcome: RunOutcome;
		summary?: Record<string, unknown>;
		now?: string;
	},
): void {
	const result = db
		.prepare(
			"UPDATE runs SET finished_at = ?, outcome = ?, summary = ? WHERE id = ?",
		)
		.run(
			opts.now ?? new Date().toISOString(),
			opts.outcome,
			JSON.stringify(opts.summary ?? {}),
			id,
		);
	if (result.changes !== 1) throw new Error(`No run ${id}`);
}
