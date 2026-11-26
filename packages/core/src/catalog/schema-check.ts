// Is a catalog's structure the one its format says? (D68)
//
// A catalog is a database file, and a database file carries its own tables,
// indexes, views and triggers. One that came from someone else can hold a
// trigger the tracker never wrote: it fires on an ordinary update the tracker
// makes while signing, and changes a source's class or public title just
// before the manifest is built. The format number says nothing about that.
//
// So a catalog is opened only when everything in its schema is exactly what
// the released SQL for its format creates: nothing added, nothing missing,
// nothing reworded. Missing counts as much as added, because the triggers
// that keep history and readings from being rewritten are part of the schema.
//
// Pure: it reads sqlite_schema from a database it is handed, which runs no
// trigger and no view. The caller makes the reference (core never opens a
// database): an empty one that the format's own SQL has been run on.

import type { DatabaseSync } from "node:sqlite";
import { CATALOG_V1_SQL } from "./schema-v1.ts";
import { CATALOG_V2_SQL } from "./schema-v2.ts";

/**
 * The SQL each released format was made with. A new catalog and one upgraded
 * to the same format have the same schema (the tests hold every format to
 * that), so one text per format is the whole reference.
 */
export const RELEASED_SQL: Readonly<Record<number, string>> = {
	1: CATALOG_V1_SQL,
	2: CATALOG_V2_SQL,
};

export interface SchemaObject {
	type: string;
	name: string;
	/** The table it belongs to (itself, for a table). */
	table: string;
	/** The statement that made it; null for what SQLite makes itself. */
	sql: string | null;
}

/**
 * Tables SQLite keeps for its own use and may add to any database: the
 * planner's statistics, written by ANALYZE. They hold numbers about the
 * indexes and can run nothing.
 */
const SQLITE_OWN = /^sqlite_stat[1-4]$/;

/** Everything in a database's schema, in a fixed order. Runs nothing in it. */
export function schemaObjects(db: DatabaseSync): SchemaObject[] {
	return (
		db
			.prepare(
				"SELECT type, name, tbl_name AS tbl, sql FROM sqlite_schema ORDER BY type, name",
			)
			.all() as Array<{
			type: string;
			name: string;
			tbl: string;
			sql: string | null;
		}>
	)
		.filter((o) => !(o.type === "table" && SQLITE_OWN.test(o.name)))
		.map((o) => ({ type: o.type, name: o.name, table: o.tbl, sql: o.sql }));
}

/**
 * How a catalog's schema differs from its format's, in words; empty when it
 * is the same. At most a few are named: one is enough to refuse.
 * @param actual schemaObjects of the catalog
 * @param expected schemaObjects of an empty database the format's SQL was run on
 */
export function schemaDifferences(
	actual: readonly SchemaObject[],
	expected: readonly SchemaObject[],
): string[] {
	const key = (o: SchemaObject) => `${o.type} ${o.name}`;
	const want = new Map(expected.map((o) => [key(o), o]));
	const have = new Map(actual.map((o) => [key(o), o]));
	const out: string[] = [];
	const named = (o: SchemaObject) =>
		`${/^[aeiou]/.test(o.type) ? "an" : "a"} ${o.type} named "${o.name}"${o.table !== o.name ? ` on "${o.table}"` : ""}`;
	for (const o of actual) {
		const w = want.get(key(o));
		if (!w) out.push(`it has ${named(o)}, which the format does not`);
		else if (w.sql !== o.sql || w.table !== o.table)
			out.push(`its ${o.type} "${o.name}" is not as the format defines it`);
	}
	for (const o of expected)
		if (!have.has(key(o))) out.push(`it has no ${o.type} named "${o.name}"`);
	return out.slice(0, 5);
}
