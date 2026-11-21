// What the catalog itself says about a table's columns: their names and
// defaults, read from SQLite so the SQL stays the one source.

import type { DatabaseSync } from "node:sqlite";

export interface ColumnInfo {
	name: string;
	notNull: boolean;
	/** The column's default as a stored value; absent when it has none. */
	default?: { value: string | number | null };
}

const cache = new WeakMap<DatabaseSync, Map<string, Map<string, ColumnInfo>>>();

/** A DEFAULT clause's literal ('text', 12, 1.5, NULL) as the value it stores. */
export function parseDefault(literal: string): string | number | null {
	if (/^null$/i.test(literal)) return null;
	const quoted = /^'((?:[^']|'')*)'$/.exec(literal);
	if (quoted) return quoted[1].replaceAll("''", "'");
	if (/^-?\d+(\.\d+)?$/.test(literal)) return Number(literal);
	throw new Error(`Unsupported column default ${literal}`);
}

/** Drop what was read about this database's columns (after its schema changes). */
export function forgetColumns(db: DatabaseSync): void {
	cache.delete(db);
}

export function columnsOf(
	db: DatabaseSync,
	table: string,
): Map<string, ColumnInfo> {
	let tables = cache.get(db);
	if (!tables) cache.set(db, (tables = new Map()));
	let cols = tables.get(table);
	if (cols) return cols;
	const rows = db
		.prepare('SELECT name, "notnull", dflt_value FROM pragma_table_info(?)')
		.all(table) as Array<{
		name: string;
		notnull: number;
		dflt_value: string | null;
	}>;
	if (rows.length === 0) throw new Error(`No table "${table}" in the catalog`);
	cols = new Map();
	for (const r of rows) {
		const info: ColumnInfo = { name: r.name, notNull: r.notnull === 1 };
		if (r.dflt_value !== null)
			info.default = { value: parseDefault(r.dflt_value) };
		else if (!info.notNull) info.default = { value: null };
		cols.set(r.name, info);
	}
	tables.set(table, cols);
	return cols;
}
