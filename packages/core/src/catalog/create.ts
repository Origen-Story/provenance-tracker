// Write a new, empty catalog into a database that has nothing in it.

import type { DatabaseSync } from "node:sqlite";
import {
	CATALOG_FORMAT,
	inspectCatalog,
	inTransaction,
	prepareConnection,
} from "./format.ts";
import { CATALOG_V3_SQL } from "./schema-v3.ts";
import { setMeta } from "./edit.ts";

/** The SQL that creates a catalog of the current format. */
export const CURRENT_SCHEMA_SQL = CATALOG_V3_SQL;

export interface Tool {
	/** The program writing to the catalog ("provenancetracker"). */
	name: string;
	version: string;
}

export interface NewCatalog {
	/** A UUID; this machine's settings find the project's roots by it. */
	projectId: string;
	name: string;
	tool: Tool;
	/** ISO 8601 UTC; defaults to now. */
	now?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Create the tables, record the creation as the first run, and write the
 * project's id and name. Refuses a database that already has anything in it.
 * @returns the id of the creation run
 */
export function createCatalog(db: DatabaseSync, opts: NewCatalog): number {
	const { projectId, name, tool } = opts;
	const now = opts.now ?? new Date().toISOString();
	if (!UUID.test(projectId))
		throw new Error("projectId must be a lower-case UUID");
	if (!name.trim()) throw new Error("A project needs a name");
	const state = inspectCatalog(db);
	if (state.state !== "empty")
		throw new Error(
			`A catalog can only be created in an empty database (this one is ${state.state})`,
		);
	prepareConnection(db);
	return inTransaction(db, () => {
		db.exec(CURRENT_SCHEMA_SQL);
		const run = db
			.prepare(
				`INSERT INTO runs (kind, tool, tool_version, started_at, finished_at, outcome, summary)
				 VALUES ('create', ?, ?, ?, ?, 'ok', ?)`,
			)
			.run(
				tool.name,
				tool.version,
				now,
				now,
				JSON.stringify({ format: CATALOG_FORMAT }),
			);
		const runId = Number(run.lastInsertRowid);
		const insertMeta = db.prepare(
			"INSERT INTO meta (key, value) VALUES (?, ?)",
		);
		insertMeta.run("project_id", projectId);
		insertMeta.run("created_at", now);
		insertMeta.run("created_with", `${tool.name} ${tool.version}`);
		// The name can change later, so it starts its history here.
		setMeta(db, "name", name.trim(), {
			actor: { kind: "tool", name: `${tool.name} ${tool.version}`, runId },
			now,
		});
		return runId;
	});
}
