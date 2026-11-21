// The only way a human-editable field changes: the row and a history entry
// for each field that really changed, in one transaction (roadmap goal 3).
//
// Who made the change is always said: a person by name, a tool by name and
// version (with the run it belongs to), or "legacy" for a value carried from
// an older system that cannot say whether a person typed it or a tool read it.

import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { inTransaction } from "./format.ts";
import { columnsOf } from "./columns.ts";
import {
	EDITABLE_META,
	foldForSearch,
	tableSpec,
	toColumn,
	toHistory,
	type FieldSpec,
	type TableSpec,
} from "./fields.ts";

export type ActorKind = "person" | "tool" | "legacy";

export interface Actor {
	kind: ActorKind;
	/** The person's name, or the tool and its version ("provenancetracker 0.3.0"). */
	name: string;
	/** The run a tool's change belongs to. */
	runId?: number | null;
}

export interface ChangeOptions {
	actor: Actor;
	/** Why, in the person's words. */
	note?: string;
	/** What the change rests on (an observation id, a file name, a rule). */
	evidence?: Record<string, unknown>;
	/** ISO 8601 UTC; defaults to now. */
	now?: string;
}

export type RowKey = string | number;

const ACTOR_KINDS: readonly string[] = ["person", "tool", "legacy"];

function checkActor(actor: Actor | undefined): Actor {
	if (!actor || !ACTOR_KINDS.includes(actor.kind))
		throw new Error("Say who made the change: a person, a tool or legacy");
	if (typeof actor.name !== "string" || !actor.name.trim())
		throw new Error(`A ${actor.kind} actor needs a name`);
	return actor;
}

function keyOf(row: Record<string, unknown>, spec: TableSpec): RowKey {
	return row[spec.key] as RowKey;
}

interface Entry {
	table: string;
	key: RowKey;
	field: string;
	/** JSON text; null when the row is being created. */
	oldValue: string | null;
	/** JSON text; null when the row is being removed. */
	newValue: string | null;
}

function writeHistory(
	db: DatabaseSync,
	entries: Entry[],
	opts: ChangeOptions,
	now: string,
): void {
	const insert = db.prepare(
		`INSERT INTO history (at, actor_kind, actor, run_id, table_name, row_key, field, old_value, new_value, note, evidence)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const e of entries)
		insert.run(
			now,
			opts.actor.kind,
			opts.actor.name.trim(),
			opts.actor.runId ?? null,
			e.table,
			String(e.key),
			e.field,
			e.oldValue,
			e.newValue,
			opts.note ?? "",
			JSON.stringify(opts.evidence ?? {}),
		);
}

function hasHistory(
	db: DatabaseSync,
	table: string,
	key: RowKey,
	field: string,
): boolean {
	return (
		db
			.prepare(
				"SELECT 1 FROM history WHERE table_name = ? AND row_key = ? AND field = ? LIMIT 1",
			)
			.get(table, String(key), field) !== undefined
	);
}

function selectRow(
	db: DatabaseSync,
	table: string,
	spec: TableSpec,
	key: RowKey,
): Record<string, unknown> | undefined {
	return db
		.prepare(`SELECT * FROM "${table}" WHERE "${spec.key}" = ?`)
		.get(key) as Record<string, unknown> | undefined;
}

const DERIVED = new Set(["updated_at"]);

function foldedColumns(spec: TableSpec): Map<string, string> {
	const out = new Map<string, string>();
	for (const [field, f] of Object.entries(spec.fields))
		if (f.folded) out.set(f.folded, field);
	return out;
}

/**
 * Add a row. Editable fields are converted and checked; any other column
 * (a hash, a time, a foreign key the row is born with) is written as given.
 * Each editable field given a value other than its default gets a history
 * entry, and so does any field that has history from an earlier row with the
 * same key, so the record stays continuous.
 * @returns the new row's key
 */
export function createRow(
	db: DatabaseSync,
	table: string,
	values: Record<string, unknown>,
	opts: ChangeOptions,
): RowKey {
	const spec = tableSpec(table);
	checkActor(opts.actor);
	const now = opts.now ?? new Date().toISOString();
	const cols = columnsOf(db, table);
	const folded = foldedColumns(spec);
	return inTransaction(db, () => {
		const row: Record<string, SQLInputValue> = {};
		for (const [col, value] of Object.entries(values)) {
			if (!cols.has(col)) throw new Error(`${table} has no column ${col}`);
			if (folded.has(col) || DERIVED.has(col))
				throw new Error(`${table}.${col} is written by the catalog itself`);
			const f = spec.fields[col];
			row[col] = f ? toColumn(f, col, value) : (value as SQLInputValue);
		}
		for (const [fold, field] of folded)
			if (typeof row[field] === "string")
				row[fold] = foldForSearch(row[field] as string);
		if (cols.has("created_at") && row.created_at === undefined)
			row.created_at = now;
		if (cols.has("updated_at")) row.updated_at = now;
		const names = Object.keys(row);
		const result = db
			.prepare(
				`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")})
				 VALUES (${names.map(() => "?").join(", ")})`,
			)
			.run(...names.map((n) => row[n]));
		const key: RowKey =
			row[spec.key] !== undefined
				? (row[spec.key] as RowKey)
				: Number(result.lastInsertRowid);
		const entries: Entry[] = [];
		for (const [field, f] of Object.entries(spec.fields)) {
			const dflt = cols.get(field)?.default;
			const supplied = row[field] !== undefined;
			const value = toHistory(f, supplied ? row[field] : dflt?.value);
			const isDefault =
				dflt !== undefined && value === toHistory(f, dflt.value);
			if (!isDefault || hasHistory(db, table, key, field))
				entries.push({ table, key, field, oldValue: null, newValue: value });
		}
		writeHistory(db, entries, opts, now);
		return key;
	});
}

/**
 * Change editable fields of one row. A field set to the value it already
 * has is left alone and gets no history entry.
 * @returns the fields that changed
 */
export function editRow(
	db: DatabaseSync,
	table: string,
	key: RowKey,
	changes: Record<string, unknown>,
	opts: ChangeOptions,
): string[] {
	const spec = tableSpec(table);
	checkActor(opts.actor);
	const now = opts.now ?? new Date().toISOString();
	const cols = columnsOf(db, table);
	return inTransaction(db, () => {
		const current = selectRow(db, table, spec, key);
		if (!current) throw new Error(`No ${table} row ${key}`);
		const set: Record<string, SQLInputValue> = {};
		const entries: Entry[] = [];
		for (const [field, value] of Object.entries(changes)) {
			const f: FieldSpec | undefined = Object.hasOwn(spec.fields, field)
				? spec.fields[field]
				: undefined;
			if (!f) throw new Error(`${table}.${field} is not an editable field`);
			const stored = toColumn(f, field, value);
			const oldValue = toHistory(f, current[field]);
			const newValue = toHistory(f, stored);
			if (oldValue === newValue) continue;
			set[field] = stored;
			if (f.folded) set[f.folded] = foldForSearch(stored as string);
			entries.push({
				table,
				key: keyOf(current, spec),
				field,
				oldValue,
				newValue,
			});
		}
		if (entries.length === 0) return [];
		if (cols.has("updated_at")) set.updated_at = now;
		const names = Object.keys(set);
		db.prepare(
			`UPDATE "${table}" SET ${names.map((n) => `"${n}" = ?`).join(", ")} WHERE "${spec.key}" = ?`,
		).run(...names.map((n) => set[n]), key);
		writeHistory(db, entries, opts, now);
		return entries.map((e) => e.field);
	});
}

function removalEntries(
	table: string,
	spec: TableSpec,
	row: Record<string, unknown>,
): Entry[] {
	return Object.entries(spec.fields).map(([field, f]) => ({
		table,
		key: keyOf(row, spec),
		field,
		oldValue: toHistory(f, row[field]),
		newValue: null,
	}));
}

/**
 * Delete a row of a table whose rows may be removed (a credit, a link, a
 * timeline with its sources and clips), recording each field's last value.
 * Assets are never deleted: set removed_at instead.
 */
export function removeRow(
	db: DatabaseSync,
	table: string,
	key: RowKey,
	opts: ChangeOptions,
): void {
	const spec = tableSpec(table);
	if (!spec.removable)
		throw new Error(
			table === "assets"
				? "Assets are never deleted; set removed_at instead"
				: `${table} rows are never deleted`,
		);
	checkActor(opts.actor);
	const now = opts.now ?? new Date().toISOString();
	inTransaction(db, () => {
		const row = selectRow(db, table, spec, key);
		if (!row) throw new Error(`No ${table} row ${key}`);
		const entries: Entry[] = [];
		for (const child of spec.children ?? []) {
			const childSpec = tableSpec(child.table);
			const rows = db
				.prepare(
					`SELECT * FROM "${child.table}" WHERE "${child.foreignKey}" = ?`,
				)
				.all(key) as Array<Record<string, unknown>>;
			for (const r of rows)
				entries.push(...removalEntries(child.table, childSpec, r));
		}
		entries.push(...removalEntries(table, spec, row));
		db.prepare(`DELETE FROM "${table}" WHERE "${spec.key}" = ?`).run(key);
		writeHistory(db, entries, opts, now);
	});
}

/** Set one of the project settings that may change (EDITABLE_META). */
export function setMeta(
	db: DatabaseSync,
	key: string,
	value: string,
	opts: ChangeOptions,
): boolean {
	if (!EDITABLE_META.includes(key))
		throw new Error(`The project setting "${key}" cannot be changed`);
	if (typeof value !== "string")
		throw new Error(`The project setting "${key}" takes text`);
	checkActor(opts.actor);
	const now = opts.now ?? new Date().toISOString();
	return inTransaction(db, () => {
		const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
			{ value: string } | undefined;
		if (row?.value === value) return false;
		db.prepare(
			"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
		).run(key, value);
		writeHistory(
			db,
			[
				{
					table: "meta",
					key,
					field: "value",
					oldValue: row ? JSON.stringify(row.value) : null,
					newValue: JSON.stringify(value),
				},
			],
			opts,
			now,
		);
		return true;
	});
}
