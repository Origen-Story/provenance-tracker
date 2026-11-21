import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
	createRow,
	editRow,
	removeRow,
	setMeta,
	type ChangeOptions,
} from "../../src/catalog/edit.ts";
import { verifyCatalog } from "../../src/catalog/verify.ts";
import { finishRun, startRun } from "../../src/catalog/runs.ts";
import { EDITABLE, foldForSearch } from "../../src/catalog/fields.ts";
import { columnsOf, parseDefault } from "../../src/catalog/columns.ts";
import { inTransaction } from "../../src/catalog/format.ts";
import { PERSON, TEST_TOOL, sha } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";

const { catalog, sample } = catalogsForTests();
const AT = "2026-11-21T12:00:00.000Z";
const LATER = "2026-11-22T09:30:00.000Z";

type Row = Record<string, unknown>;
const one = (db: DatabaseSync, sql: string, ...p: Array<string | number>) =>
	db.prepare(sql).get(...p) as Row;
const historyOf = (db: DatabaseSync, table: string, key: string | number) =>
	db
		.prepare(
			"SELECT actor_kind, actor, run_id, field, old_value, new_value, note, evidence FROM history WHERE table_name = ? AND row_key = ? ORDER BY id",
		)
		.all(table, String(key)) as Row[];

function newAsset(db: DatabaseSync, values: Row = {}, opts = PERSON) {
	return Number(
		createRow(
			db,
			"assets",
			{ kind: "archival", title: "Photo", ...values },
			opts,
		),
	);
}

describe("editRow", () => {
	it("changes the row and writes one history entry per changed field, in one go", () => {
		const db = catalog();
		const id = newAsset(db);
		const changed = editRow(
			db,
			"assets",
			id,
			{
				origin_class: "digitalCapture",
				origin_class_confirmed: true,
				title: "Photo",
			},
			{
				...PERSON,
				note: "Scanned print",
				evidence: { observation: 4 },
				now: LATER,
			},
		);
		expect(changed).toEqual(["origin_class", "origin_class_confirmed"]);
		const row = one(
			db,
			"SELECT origin_class, origin_class_confirmed, updated_at, created_at FROM assets WHERE id = ?",
			id,
		);
		expect(row).toEqual({
			origin_class: "digitalCapture",
			origin_class_confirmed: 1,
			updated_at: LATER,
			created_at: AT,
		});
		const entries = historyOf(db, "assets", id).slice(-2);
		expect(entries).toEqual([
			{
				actor_kind: "person",
				actor: "A. Maker",
				run_id: null,
				field: "origin_class",
				old_value: '"unknown"',
				new_value: '"digitalCapture"',
				note: "Scanned print",
				evidence: '{"observation":4}',
			},
			expect.objectContaining({
				field: "origin_class_confirmed",
				old_value: "false",
				new_value: "true",
			}),
		]);
	});

	it("does nothing, and records nothing, when no value changes", () => {
		const db = catalog();
		const id = newAsset(db);
		const before = historyOf(db, "assets", id).length;
		expect(
			editRow(
				db,
				"assets",
				id,
				{ title: "Photo", ai_assisted: false },
				{ ...PERSON, now: LATER },
			),
		).toEqual([]);
		expect(historyOf(db, "assets", id)).toHaveLength(before);
		expect(
			one(db, "SELECT updated_at FROM assets WHERE id = ?", id).updated_at,
		).toBe(AT);
	});

	it("keeps the folded copy of a title in step", () => {
		const db = catalog();
		const id = newAsset(db, { title: "La Peña" });
		expect(
			one(db, "SELECT title_folded FROM assets WHERE id = ?", id).title_folded,
		).toBe("la pena");
		editRow(db, "assets", id, { title: "ÁNGEL" }, PERSON);
		expect(
			one(db, "SELECT title_folded FROM assets WHERE id = ?", id).title_folded,
		).toBe("angel");
		expect(foldForSearch("Çà Ñ ü")).toBe("ca n u");
	});

	it("stores JSON fields as JSON, and history as their value", () => {
		const db = catalog();
		const id = newAsset(db);
		editRow(
			db,
			"assets",
			id,
			{
				origin_ingredient_classes: [
					"digitalCapture",
					"trainedAlgorithmicMedia",
				],
			},
			PERSON,
		);
		expect(
			one(
				db,
				"SELECT origin_ingredient_classes AS v FROM assets WHERE id = ?",
				id,
			).v,
		).toBe('["digitalCapture","trainedAlgorithmicMedia"]');
		expect(historyOf(db, "assets", id).at(-1)).toMatchObject({
			old_value: "[]",
			new_value: '["digitalCapture","trainedAlgorithmicMedia"]',
		});
	});

	it("refuses a field that is not editable, the wrong type, and a missing row", () => {
		const db = catalog();
		const id = newAsset(db);
		for (const field of [
			"title_folded",
			"created_at",
			"updated_at",
			"id",
			"nonsense",
			"__proto__",
		])
			expect(
				() => editRow(db, "assets", id, { [field]: "x" }, PERSON),
				field,
			).toThrow(/not an editable field/);
		expect(() =>
			editRow(db, "assets", id, { ai_assisted: "yes" }, PERSON),
		).toThrow(/true or false/);
		expect(() => editRow(db, "assets", id, { title: 3 }, PERSON)).toThrow(
			/takes text/,
		);
		expect(() => editRow(db, "assets", id, { title: null }, PERSON)).toThrow(
			/cannot be empty/,
		);
		expect(() => editRow(db, "assets", 999, { title: "x" }, PERSON)).toThrow(
			/No assets row 999/,
		);
		expect(() =>
			editRow(db, "observations", 1, { status: "ok" }, PERSON),
		).toThrow(/no editable fields/);
		expect(() => editRow(db, "runs", 1, { tool: "x" }, PERSON)).toThrow(
			/no editable fields/,
		);
	});

	it("rolls back the row and its history together when any part fails", () => {
		const db = sample();
		const before = one(db, "SELECT count(*) AS n FROM history").n;
		// The second change breaks the column's CHECK, after the first was prepared.
		expect(() =>
			editRow(
				db,
				"relationships",
				1,
				{ note: "changed", confidence: 2 },
				PERSON,
			),
		).toThrow(/CHECK/);
		expect(
			one(db, "SELECT note, confidence FROM relationships WHERE id = 1"),
		).toEqual({ note: "", confidence: 1 });
		expect(one(db, "SELECT count(*) AS n FROM history").n).toBe(before);
	});

	it("joins a transaction the caller already has, and fails with it", () => {
		const db = catalog();
		const id = newAsset(db);
		expect(() =>
			inTransaction(db, () => {
				editRow(db, "assets", id, { title: "Inside" }, PERSON);
				throw new Error("the caller's work failed");
			}),
		).toThrow(/caller's work failed/);
		expect(one(db, "SELECT title FROM assets WHERE id = ?", id).title).toBe(
			"Photo",
		);
	});

	it("says who: a person by name, a tool with its run, or legacy", () => {
		const db = catalog();
		const id = newAsset(db);
		for (const actor of [
			undefined,
			{ kind: "robot", name: "x" },
			{ kind: "person", name: "  " },
		])
			expect(() =>
				editRow(db, "assets", id, { title: "x" }, {
					actor,
				} as unknown as ChangeOptions),
			).toThrow(/Say who|needs a name/);
		const run = startRun(db, { kind: "classify", tool: TEST_TOOL, now: AT });
		editRow(
			db,
			"assets",
			id,
			{ origin_class: "digitalCapture" },
			{ actor: { kind: "tool", name: "classifier 1.0", runId: run } },
		);
		editRow(
			db,
			"assets",
			id,
			{ notes: "from the old database" },
			{ actor: { kind: "legacy", name: "Postgres import" } },
		);
		finishRun(db, run, { outcome: "ok" });
		expect(
			historyOf(db, "assets", id)
				.slice(-2)
				.map((h) => [h.actor_kind, h.actor, h.run_id]),
		).toEqual([
			["tool", "classifier 1.0", run],
			["legacy", "Postgres import", null],
		]);
	});
});

describe("createRow", () => {
	it("records each field given a value other than its default, and nothing for the rest", () => {
		const db = catalog();
		const id = newAsset(db, { origin_class: "unknown", license: "CC BY 4.0" });
		expect(
			historyOf(db, "assets", id).map((h) => [
				h.field,
				h.old_value,
				h.new_value,
			]),
		).toEqual([
			["kind", null, '"archival"'],
			["title", null, '"Photo"'],
			["license", null, '"CC BY 4.0"'],
		]);
	});

	it("writes non-editable columns as given, but not the catalog's own", () => {
		const db = catalog();
		const run = startRun(db, { kind: "scan", tool: TEST_TOOL, now: AT });
		const asset = newAsset(db);
		const key = createRow(
			db,
			"contents",
			{ sha256: sha("a"), size: 10, asset_id: asset, first_run_id: run },
			PERSON,
		);
		finishRun(db, run, { outcome: "ok" });
		expect(key).toBe(sha("a"));
		expect(historyOf(db, "contents", sha("a")).map((h) => h.field)).toEqual([
			"asset_id",
		]);
		expect(() =>
			createRow(db, "assets", { kind: "x", title_folded: "x" }, PERSON),
		).toThrow(/written by the catalog itself/);
		expect(() =>
			createRow(db, "assets", { kind: "x", colour: "red" }, PERSON),
		).toThrow(/no column colour/);
	});

	it("keeps history continuous when a removed row's key comes back", () => {
		const db = catalog();
		const asset = newAsset(db, { kind: "generated" });
		createRow(
			db,
			"generation",
			{ asset_id: asset, prompt: "first", steps: 30 },
			PERSON,
		);
		removeRow(db, "generation", asset, PERSON);
		createRow(
			db,
			"generation",
			{ asset_id: asset, platform: "midjourney" },
			PERSON,
		);
		// prompt and steps came back as their defaults ('' and null), and the
		// history says so rather than still saying "removed".
		const latest = new Map(
			historyOf(db, "generation", asset).map((h) => [h.field, h.new_value]),
		);
		expect(latest.get("platform")).toBe('"midjourney"');
		expect(latest.get("prompt")).toBe('""');
		expect(latest.get("steps")).toBe("null");
		expect(verifyCatalog(db)).toEqual([]);
	});
});

describe("removeRow", () => {
	it("records each field's last value, then deletes", () => {
		const db = sample();
		removeRow(db, "credits", 1, { ...PERSON, note: "Duplicate" });
		expect(one(db, "SELECT count(*) AS n FROM credits WHERE id = 1").n).toBe(0);
		const removal = historyOf(db, "credits", 1).filter(
			(h) => h.new_value === null,
		);
		expect(removal.map((h) => h.field).sort()).toEqual(
			Object.keys(EDITABLE.credits.fields).sort(),
		);
		expect(removal.find((h) => h.field === "name")?.old_value).toBe(
			'"Unknown photographer"',
		);
	});

	it("removes a timeline with its sources and clips, recording all of them", () => {
		const db = sample();
		removeRow(db, "timelines", 1, PERSON);
		expect(one(db, "SELECT count(*) AS n FROM timeline_clips").n).toBe(0);
		expect(one(db, "SELECT count(*) AS n FROM timeline_sources").n).toBe(0);
		expect(historyOf(db, "timeline_sources", 1).at(-1)?.new_value).toBeNull();
	});

	it("never deletes an asset, a content or a root", () => {
		const db = sample();
		expect(() => removeRow(db, "assets", 1, PERSON)).toThrow(/set removed_at/);
		expect(() => removeRow(db, "contents", sha("a"), PERSON)).toThrow(
			/never deleted/,
		);
		expect(() => removeRow(db, "roots", 1, PERSON)).toThrow(/never deleted/);
		editRow(db, "assets", 1, { removed_at: LATER }, PERSON);
		expect(
			one(db, "SELECT removed_at FROM assets WHERE id = 1").removed_at,
		).toBe(LATER);
	});
});

describe("setMeta", () => {
	it("changes a project setting with history, and refuses the fixed ones", () => {
		const db = catalog();
		expect(setMeta(db, "name", "Renamed", PERSON)).toBe(true);
		expect(setMeta(db, "name", "Renamed", PERSON)).toBe(false);
		expect(
			historyOf(db, "meta", "name").map((h) => [
				h.actor_kind,
				h.old_value,
				h.new_value,
			]),
		).toEqual([
			["tool", null, '"Sample project"'],
			["person", '"Sample project"', '"Renamed"'],
		]);
		expect(() => setMeta(db, "project_id", "x", PERSON)).toThrow(
			/cannot be changed/,
		);
		expect(() => setMeta(db, "created_at", "x", PERSON)).toThrow(
			/cannot be changed/,
		);
	});
});

describe("verifyCatalog", () => {
	const problems = (db: DatabaseSync) =>
		verifyCatalog(db).map(
			(p) =>
				`${p.check} ${p.table ?? ""} ${p.key ?? ""} ${p.field ?? ""}: ${p.detail}`,
		);

	it("finds nothing wrong with the sample catalog", () => {
		expect(verifyCatalog(sample())).toEqual([]);
	});

	it("catches a value changed around the edit functions", () => {
		const db = sample({ verify: false });
		db.exec(
			"UPDATE assets SET origin_class = 'trainedAlgorithmicMedia' WHERE id = 2",
		);
		expect(problems(db)).toEqual([
			'history assets 2 origin_class: is "trainedAlgorithmicMedia", but its latest history entry is "digitalCapture"',
		]);
	});

	it("catches a never-edited field that is not its default", () => {
		const db = sample({ verify: false });
		db.exec("UPDATE assets SET caption = 'typed in directly' WHERE id = 1");
		expect(problems(db)).toEqual([
			'history assets 1 caption: is "typed in directly", but its default (it has no history) is ""',
		]);
	});

	it("catches a row deleted around the edit functions", () => {
		const db = sample({ verify: false });
		db.exec("DELETE FROM credits WHERE id = 2");
		expect(problems(db).length).toBeGreaterThan(0);
		expect(
			problems(db).every((p) =>
				p.includes("the row is gone, but history has no entry removing it"),
			),
		).toBe(true);
	});

	it("catches a folded column out of step, and a setting changed directly", () => {
		const db = sample({ verify: false });
		db.exec("UPDATE assets SET title_folded = 'stale' WHERE id = 1");
		db.exec(
			"UPDATE meta SET value = 'Other Studio' WHERE key = 'organization'",
		);
		db.exec(
			"INSERT INTO meta (key, value) VALUES ('description', 'never recorded')",
		);
		expect(problems(db)).toEqual([
			'folded assets 1 title_folded: is "stale", should be "street interview"',
			"meta  description : is set with no history",
			'meta  organization : is "Other Studio", but its latest history entry is "Example Studio"',
		]);
	});

	it("catches a broken foreign key", () => {
		const db = sample({ verify: false });
		db.exec(
			"PRAGMA foreign_keys = OFF; UPDATE locations SET root_id = 99 WHERE id = 1; PRAGMA foreign_keys = ON;",
		);
		expect(problems(db)).toEqual([
			"foreign-key locations 1 : refers to a missing roots row",
		]);
	});
});

describe("the editable-field list", () => {
	it("names only columns that exist, with defaults the catalog can state", () => {
		const db = catalog();
		for (const [table, spec] of Object.entries(EDITABLE)) {
			const cols = columnsOf(db, table);
			expect(cols.has(spec.key), `${table}.${spec.key}`).toBe(true);
			for (const [field, f] of Object.entries(spec.fields)) {
				expect(cols.has(field), `${table}.${field}`).toBe(true);
				if (f.folded)
					expect(cols.has(f.folded), `${table}.${f.folded}`).toBe(true);
			}
			for (const child of spec.children ?? [])
				expect(columnsOf(db, child.table).has(child.foreignKey)).toBe(true);
		}
	});

	it("reads SQL default literals", () => {
		expect(parseDefault("''")).toBe("");
		expect(parseDefault("'it''s'")).toBe("it's");
		expect(parseDefault("'[]'")).toBe("[]");
		expect(parseDefault("0")).toBe(0);
		expect(parseDefault("1.5")).toBe(1.5);
		expect(parseDefault("NULL")).toBeNull();
		expect(() => parseDefault("CURRENT_TIMESTAMP")).toThrow(/Unsupported/);
	});
});

describe("runs", () => {
	it("opens before the work and seals at the end", () => {
		const db = catalog();
		const id = startRun(db, { kind: "scan", tool: TEST_TOOL, now: AT });
		expect(
			one(db, "SELECT finished_at, outcome FROM runs WHERE id = ?", id),
		).toEqual({ finished_at: null, outcome: null });
		finishRun(db, id, { outcome: "ok", summary: { files: 3 }, now: LATER });
		expect(
			one(
				db,
				"SELECT finished_at, outcome, summary FROM runs WHERE id = ?",
				id,
			),
		).toEqual({
			finished_at: LATER,
			outcome: "ok",
			summary: '{"files":3}',
		});
		expect(() => finishRun(db, id, { outcome: "failed" })).toThrow(
			/finished run never changes/,
		);
		expect(() => finishRun(db, 999, { outcome: "ok" })).toThrow(/No run 999/);
	});
});
