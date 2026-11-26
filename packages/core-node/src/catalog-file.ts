// Opening a catalog file (D68): the one place a connection to one is made,
// so every connection gets the same settings, and the check that a catalog's
// structure is the one its format says.

import { DatabaseSync } from "node:sqlite";
import { prepareConnection } from "@provenancetracker/core/catalog/format.ts";
import {
	RELEASED_SQL,
	schemaDifferences,
	schemaObjects,
	type SchemaObject,
} from "@provenancetracker/core/catalog/schema-check.ts";

/**
 * Open a catalog file with the settings every connection to one gets: foreign
 * keys, no trust in the catalog's own schema, defensive mode. A read-only
 * connection gets them too: a look is still a look at someone's file.
 */
export function openCatalogFile(
	file: string,
	opts: { readOnly?: boolean } = {},
): DatabaseSync {
	const db = new DatabaseSync(file, opts.readOnly ? { readOnly: true } : {});
	try {
		prepareConnection(db);
		return db;
	} catch (err) {
		db.close();
		throw err;
	}
}

const references = new Map<number, SchemaObject[]>();

/**
 * The schema a released format's own SQL makes, read from an empty database
 * in memory that the SQL was run on. Null for a format this tracker has no
 * SQL for.
 */
export function formatSchema(format: number): SchemaObject[] | null {
	const known = references.get(format);
	if (known) return known;
	const sql = RELEASED_SQL[format];
	if (!sql) return null;
	const db = new DatabaseSync(":memory:");
	try {
		db.exec(sql);
		const objects = schemaObjects(db);
		references.set(format, objects);
		return objects;
	} finally {
		db.close();
	}
}

/**
 * Why a catalog may not be opened for its structure, in words for the
 * person; null when its schema is exactly its format's. Reads the schema
 * table only: nothing in the catalog runs.
 */
export function structureRefusal(
	db: DatabaseSync,
	format: number,
): string | null {
	const expected = formatSchema(format);
	// A format with no SQL here is newer than this tracker, and refused as that.
	if (!expected) return null;
	let actual: SchemaObject[];
	try {
		actual = schemaObjects(db);
	} catch (err) {
		return `Its structure cannot be read (${(err as Error).message}). Nothing was changed.`;
	}
	const differences = schemaDifferences(actual, expected);
	if (!differences.length) return null;
	return `This catalog is marked format ${format}, but its structure is not that format's: ${differences.join("; ")}. Provenance Tracker opens a catalog only as it made it, because anything added to one can change the record without leaving a trace. If it came from someone else, ask them for the project folder as the tracker wrote it. Nothing was changed.`;
}
