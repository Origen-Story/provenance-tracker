// What a catalog file is, and whether this version of the tracker may open it.
//
// The rules (roadmap Phase 4, from "design for compatibility and don't break
// contracts too often"):
// - A catalog carries its format number (PRAGMA user_version) and the
//   tracker's file marker (PRAGMA application_id).
// - An older catalog is upgraded step by step when opened, after a copy of
//   the file as it was has been saved (upgrade.ts; the copy is the caller's job).
// - A catalog newer than this tracker is refused, with a message saying so.
//   It is never guessed at.
//
// Core runs SQL on a database it is handed and never opens a file: opening,
// the copy before an upgrade and WAL mode belong to the caller (core-node).

import type { DatabaseSync } from "node:sqlite";

/** 'PvTr' as a 32-bit number: marks the file as a Provenance Tracker catalog. */
export const APPLICATION_ID = 0x50765472;

/** The newest catalog format this tracker writes and reads. */
export const CATALOG_FORMAT = 2;

/**
 * "draft" until the first real catalog of this format is written; a draft
 * format may still change, a released one never does. Format 1 was released
 * with the Postgres migration (roadmap Phase 5, D35). Format 2 (D56, where a
 * signed copy is published) was released as it was made, since opening a
 * catalog upgrades it: a change to its SQL is format 3, with an upgrade step
 * and a sample of its own.
 */
export const CATALOG_FORMAT_STATUS: "draft" | "released" = "released";

export type CatalogState =
	| { state: "empty" }
	| { state: "current"; format: number }
	| { state: "older"; format: number }
	| { state: "newer"; format: number }
	| { state: "foreign"; reason: string };

function pragmaNumber(db: DatabaseSync, name: string): number {
	const row = db.prepare(`PRAGMA ${name}`).get() as
		Record<string, unknown> | undefined;
	return Number(row?.[name] ?? 0);
}

/** Read what kind of file this is. Changes nothing. */
export function inspectCatalog(db: DatabaseSync): CatalogState {
	const applicationId = pragmaNumber(db, "application_id");
	const format = pragmaNumber(db, "user_version");
	const objects = Number(
		(
			db.prepare("SELECT count(*) AS n FROM sqlite_schema").get() as {
				n: number;
			}
		).n,
	);
	if (applicationId === 0 && format === 0 && objects === 0)
		return { state: "empty" };
	if (applicationId !== APPLICATION_ID)
		return {
			state: "foreign",
			reason:
				applicationId === 0
					? "it is an SQLite database, but not a Provenance Tracker catalog"
					: `it belongs to another program (application id ${applicationId})`,
		};
	if (format < 1)
		return {
			state: "foreign",
			reason: "it is marked as a catalog but has no format number",
		};
	if (format === CATALOG_FORMAT) return { state: "current", format };
	if (format < CATALOG_FORMAT) return { state: "older", format };
	return { state: "newer", format };
}

/** Why a catalog cannot be opened as it is, in words for the person; null when it can. */
export function refusalMessage(state: CatalogState): string | null {
	switch (state.state) {
		case "newer":
			return `This catalog is format ${state.format}, and this version of Provenance Tracker reads formats up to ${CATALOG_FORMAT}. Update Provenance Tracker to open it. Nothing was changed.`;
		case "foreign":
			return `This file is not a catalog Provenance Tracker can open: ${state.reason}. Nothing was changed.`;
		default:
			return null;
	}
}

/**
 * Settings every connection to a catalog needs, a read-only one too (D68).
 * Foreign keys are off by default in SQLite and per connection.
 * trusted_schema off stops a catalog someone else made from running functions
 * with side effects through its own views and triggers. Defensive mode stops
 * any SQL, a trigger's included, from rewriting the schema table, writing to
 * an index's own tables or switching the journal off.
 */
export function prepareConnection(db: DatabaseSync): void {
	db.exec("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
	const defensive = (
		db as DatabaseSync & { enableDefensive?: (active: boolean) => void }
	).enableDefensive;
	// A safety setting is never skipped quietly: without it the tracker does
	// not open a catalog at all.
	if (typeof defensive !== "function")
		throw new Error(
			"This version of Node cannot turn on SQLite's defensive mode, which every catalog is opened with. Update Node 24 to its newest release.",
		);
	defensive.call(db, true);
}

let savepoints = 0;

/**
 * Run fn inside one write transaction; roll back if it throws. Inside an
 * open transaction it uses a savepoint, so functions that each need a
 * transaction can call one another and still commit or fail as one.
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
	if (db.isTransaction) {
		const name = `pt_${++savepoints}`;
		db.exec(`SAVEPOINT ${name}`);
		try {
			const result = fn();
			db.exec(`RELEASE ${name}`);
			return result;
		} catch (err) {
			db.exec(`ROLLBACK TO ${name}`);
			db.exec(`RELEASE ${name}`);
			throw err;
		}
	}
	db.exec("BEGIN IMMEDIATE");
	try {
		const result = fn();
		db.exec("COMMIT");
		return result;
	} catch (err) {
		if (db.isTransaction) db.exec("ROLLBACK");
		throw err;
	}
}
