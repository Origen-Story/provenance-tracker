// Check a catalog against its own rules. Reads only.
//
// The check that matters most (roadmap risk: "an edit reaches a row without
// leaving a history entry"): every editable field (fields.ts) equals its
// latest history entry, or its column's default if it has never been
// changed; a row that is gone has a history entry saying so. Anything written
// around edit.ts shows up here.

import type { DatabaseSync } from "node:sqlite";
import { columnsOf } from "./columns.ts";
import { EDITABLE, EDITABLE_META, foldForSearch, toHistory } from "./fields.ts";

export interface Problem {
	check: "integrity" | "foreign-key" | "history" | "folded" | "meta";
	table?: string;
	key?: string;
	field?: string;
	detail: string;
}

const REQUIRED_META = ["project_id", "name", "created_at", "created_with"];

/** The newest history entry per row and field of one table: "key\u0000field" → new_value. */
function latestHistory(
	db: DatabaseSync,
	table: string,
): Map<string, string | null> {
	const rows = db
		.prepare(
			`SELECT row_key, field, new_value FROM history
			 WHERE id IN (SELECT max(id) FROM history WHERE table_name = ? GROUP BY row_key, field)`,
		)
		.all(table) as Array<{
		row_key: string;
		field: string;
		new_value: string | null;
	}>;
	return new Map(
		rows.map((r) => [`${r.row_key}\u0000${r.field}`, r.new_value]),
	);
}

export function verifyCatalog(db: DatabaseSync): Problem[] {
	const problems: Problem[] = [];

	const integrity = db.prepare("PRAGMA integrity_check").all() as Array<{
		integrity_check: string;
	}>;
	for (const r of integrity)
		if (r.integrity_check !== "ok")
			problems.push({ check: "integrity", detail: r.integrity_check });
	for (const r of db.prepare("PRAGMA foreign_key_check").all() as Array<
		Record<string, unknown>
	>)
		problems.push({
			check: "foreign-key",
			table: String(r.table),
			key: String(r.rowid),
			detail: `refers to a missing ${String(r.parent)} row`,
		});

	for (const [table, spec] of Object.entries(EDITABLE)) {
		const cols = columnsOf(db, table);
		const latest = latestHistory(db, table);
		const seen = new Set<string>();
		const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Array<
			Record<string, unknown>
		>;
		for (const row of rows) {
			const key = String(row[spec.key]);
			for (const [field, f] of Object.entries(spec.fields)) {
				const id = `${key}\u0000${field}`;
				seen.add(id);
				const actual = toHistory(f, row[field]);
				const dflt = cols.get(field)?.default;
				let expected: string | null | undefined;
				let source: string;
				if (latest.has(id)) {
					expected = latest.get(id);
					source = "its latest history entry";
				} else {
					expected = dflt === undefined ? undefined : toHistory(f, dflt.value);
					source = "its default (it has no history)";
				}
				if (expected === null)
					problems.push({
						check: "history",
						table,
						key,
						field,
						detail: "history says the row was removed, but it is still here",
					});
				else if (expected === undefined)
					problems.push({
						check: "history",
						table,
						key,
						field,
						detail: `is ${actual} with no history, and the column has no default`,
					});
				else if (actual !== expected)
					problems.push({
						check: "history",
						table,
						key,
						field,
						detail: `is ${actual}, but ${source} is ${expected}`,
					});
				if (f.folded && typeof row[field] === "string") {
					const want = foldForSearch(row[field] as string);
					if (row[f.folded] !== want)
						problems.push({
							check: "folded",
							table,
							key,
							field: f.folded,
							detail: `is ${JSON.stringify(row[f.folded])}, should be ${JSON.stringify(want)}`,
						});
				}
			}
		}
		for (const [id, value] of latest) {
			if (seen.has(id) || value === null) continue;
			const [key, field] = id.split("\u0000");
			if (!Object.hasOwn(spec.fields, field)) {
				problems.push({
					check: "history",
					table,
					key,
					field,
					detail: "history names a field that is not editable",
				});
				continue;
			}
			problems.push({
				check: "history",
				table,
				key,
				field,
				detail: "the row is gone, but history has no entry removing it",
			});
		}
	}

	const meta = new Map(
		(
			db.prepare("SELECT key, value FROM meta").all() as Array<{
				key: string;
				value: string;
			}>
		).map((r) => [r.key, r.value]),
	);
	for (const key of REQUIRED_META)
		if (!meta.has(key))
			problems.push({
				check: "meta",
				key,
				detail: "a required project setting is missing",
			});
	const metaHistory = latestHistory(db, "meta");
	for (const key of EDITABLE_META) {
		const id = `${key}\u0000value`;
		const recorded = metaHistory.get(id);
		const value = meta.get(key);
		if (value === undefined && (recorded === undefined || recorded === null))
			continue;
		if (
			value === undefined ||
			recorded === undefined ||
			recorded !== JSON.stringify(value)
		)
			problems.push({
				check: "meta",
				key,
				detail:
					recorded === undefined
						? "is set with no history"
						: `is ${JSON.stringify(value ?? null)}, but its latest history entry is ${recorded}`,
			});
	}
	return problems;
}
