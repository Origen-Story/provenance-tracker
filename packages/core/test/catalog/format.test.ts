import { describe, it, expect, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	APPLICATION_ID,
	CATALOG_FORMAT,
	CATALOG_FORMAT_STATUS,
	inspectCatalog,
	prepareConnection,
	refusalMessage,
} from "../../src/catalog/format.ts";
import { createCatalog, CURRENT_SCHEMA_SQL } from "../../src/catalog/create.ts";
import { upgradeCatalog, UPGRADES } from "../../src/catalog/upgrade.ts";
import {
	PROJECT_ID,
	TEST_TOOL,
	dataTables,
	fillSample,
	memoryCatalog,
	schemaOf,
	sha,
} from "../helpers/catalog.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SAMPLES = path.join(HERE, "..", "fixtures", "catalog");
const AT = "2026-11-21T12:00:00.000Z";

const open: DatabaseSync[] = [];
const temps: string[] = [];
afterEach(() => {
	for (const db of open.splice(0)) if (db.isOpen) db.close();
	for (const dir of temps.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function track(db: DatabaseSync) {
	open.push(db);
	return db;
}
function sample() {
	const db = track(memoryCatalog());
	fillSample(db);
	return db;
}
const one = (db: DatabaseSync, sql: string, ...p: Array<string | number>) =>
	db.prepare(sql).get(...p) as Record<string, unknown>;

describe("creating a catalog", () => {
	it("writes the format number, the file marker, the project and a first run", () => {
		const db = track(memoryCatalog());
		expect(inspectCatalog(db)).toEqual({
			state: "current",
			format: CATALOG_FORMAT,
		});
		expect(one(db, "PRAGMA application_id").application_id).toBe(
			APPLICATION_ID,
		);
		expect(
			one(db, "SELECT value FROM meta WHERE key = 'project_id'").value,
		).toBe(PROJECT_ID);
		expect(one(db, "SELECT kind, outcome FROM runs WHERE id = 1")).toEqual({
			kind: "create",
			outcome: "ok",
		});
		expect(one(db, "PRAGMA integrity_check").integrity_check).toBe("ok");
	});

	it("refuses a database that already has something in it, or a bad project id", () => {
		const db = track(memoryCatalog());
		expect(() =>
			createCatalog(db, {
				projectId: PROJECT_ID,
				name: "Again",
				tool: TEST_TOOL,
			}),
		).toThrow(/empty database/);
		const other = track(new DatabaseSync(":memory:"));
		other.exec("CREATE TABLE notes (x TEXT)");
		expect(() =>
			createCatalog(other, {
				projectId: PROJECT_ID,
				name: "X",
				tool: TEST_TOOL,
			}),
		).toThrow(/empty database \(this one is foreign\)/);
		const empty = track(new DatabaseSync(":memory:"));
		expect(() =>
			createCatalog(empty, {
				projectId: "not-a-uuid",
				name: "X",
				tool: TEST_TOOL,
			}),
		).toThrow(/UUID/);
		expect(inspectCatalog(empty)).toEqual({ state: "empty" });
	});

	it("turns on foreign keys and turns off trusted schema for the connection", () => {
		const db = track(memoryCatalog());
		expect(one(db, "PRAGMA foreign_keys").foreign_keys).toBe(1);
		expect(one(db, "PRAGMA trusted_schema").trusted_schema).toBe(0);
	});

	it("holds a row in every table without breaking a foreign key", () => {
		const db = sample();
		for (const table of dataTables(db))
			expect(
				Number(one(db, `SELECT count(*) AS n FROM "${table}"`).n),
				table,
			).toBeGreaterThan(0);
		expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	});
});

describe("the published SQL", () => {
	it(`spec/catalog/catalog.v${CATALOG_FORMAT}.sql is the format's SQL (npm run catalog:write)`, () => {
		const file = path.join(
			ROOT,
			"spec",
			"catalog",
			`catalog.v${CATALOG_FORMAT}.sql`,
		);
		expect(readFileSync(file, "utf8").replaceAll("\r\n", "\n")).toBe(
			CURRENT_SCHEMA_SQL,
		);
	});

	it("makes a working catalog when run on its own, as the sqlite3 shell would", () => {
		const db = track(new DatabaseSync(":memory:"));
		db.exec(CURRENT_SCHEMA_SQL);
		expect(inspectCatalog(db)).toEqual({
			state: "current",
			format: CATALOG_FORMAT,
		});
	});
});

describe("records that never change", () => {
	const refused: Array<[string, string, RegExp]> = [
		[
			"observations",
			"UPDATE observations SET status = 'absent'",
			/observations never change/,
		],
		["observations", "DELETE FROM observations", /never deleted/],
		[
			"history",
			"UPDATE history SET new_value = '\"x\"'",
			/history never changes/,
		],
		["history", "DELETE FROM history", /never deleted/],
		["statements", "UPDATE statements SET text = 'edited'", /save a new one/],
		["statements", "DELETE FROM statements", /never deleted/],
		[
			"signatures",
			"UPDATE signatures SET status = 'Invalid'",
			/signatures never change/,
		],
		["signatures", "DELETE FROM signatures", /never deleted/],
		["contents", "UPDATE contents SET size = 1", /never change/],
		["contents", "DELETE FROM contents", /never deleted/],
		[
			"runs",
			"UPDATE runs SET outcome = 'failed' WHERE id = 1",
			/finished run never changes/,
		],
		["runs", "DELETE FROM runs", /never deleted/],
		["assets", "DELETE FROM assets", /set removed_at/],
	];
	for (const [table, sql, message] of refused)
		it(`refuses: ${sql}`, () => {
			const db = sample();
			const before = one(db, `SELECT count(*) AS n FROM ${table}`).n;
			expect(() => db.exec(sql)).toThrow(message);
			expect(one(db, `SELECT count(*) AS n FROM ${table}`).n).toBe(before);
		});

	it("lets a content move to another asset (an edit), but not change its bytes", () => {
		const db = sample();
		db.prepare("UPDATE contents SET asset_id = 1 WHERE sha256 = ?").run(
			sha("b"),
		);
		expect(
			one(db, "SELECT asset_id FROM contents WHERE sha256 = ?", sha("b"))
				.asset_id,
		).toBe(1);
	});

	it("lets an open run record its ending once, then seals it", () => {
		const db = sample();
		const id = Number(
			db
				.prepare(
					"INSERT INTO runs (kind, tool, tool_version, started_at) VALUES ('scan', 't', '1', ?)",
				)
				.run(AT).lastInsertRowid,
		);
		db.prepare("UPDATE runs SET summary = '{\"seen\":3}' WHERE id = ?").run(id);
		db.prepare(
			"UPDATE runs SET finished_at = ?, outcome = 'ok' WHERE id = ?",
		).run(AT, id);
		expect(() =>
			db.prepare("UPDATE runs SET summary = '{}' WHERE id = ?").run(id),
		).toThrow(/finished run/);
		const openRun = Number(
			db
				.prepare(
					"INSERT INTO runs (kind, tool, tool_version, started_at) VALUES ('scan', 't', '1', ?)",
				)
				.run(AT).lastInsertRowid,
		);
		expect(() =>
			db.prepare("UPDATE runs SET tool = 'other' WHERE id = ?").run(openRun),
		).toThrow(/open run changes only/);
	});
});

describe("what the columns accept", () => {
	it("refuses the wrong type, invalid JSON and a malformed hash", () => {
		const db = sample();
		expect(() => db.exec("UPDATE assets SET is_output = 'yes'")).toThrow();
		expect(() =>
			db.exec("UPDATE assets SET origin_ingredient_classes = '[unclosed'"),
		).toThrow(/json_valid/);
		expect(() =>
			db
				.prepare(
					"INSERT INTO contents (sha256, size, asset_id, first_run_id, created_at) VALUES (?, 1, 1, 1, ?)",
				)
				.run("ABC", AT),
		).toThrow(/CHECK/);
		expect(() =>
			db
				.prepare(
					"INSERT INTO contents (sha256, size, asset_id, first_run_id, created_at) VALUES (?, 1, 1, 1, ?)",
				)
				.run(sha("A"), AT),
		).toThrow(/CHECK/);
	});

	it("refuses a broken foreign key", () => {
		const db = sample();
		expect(() =>
			db
				.prepare(
					"INSERT INTO contents (sha256, size, asset_id, first_run_id, created_at) VALUES (?, 1, 999, 1, ?)",
				)
				.run(sha("7"), AT),
		).toThrow(/FOREIGN KEY/);
	});

	it("takes a path relative to its root, written with '/', and nothing that climbs out", () => {
		const db = sample();
		const add = (p: string) =>
			db
				.prepare(
					`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
					 VALUES (?, 1, ?, 0, 1, 1)`,
				)
				.run(sha("a"), p);
		for (const bad of [
			"",
			"/abs/file.mp4",
			"C:/media/file.mp4",
			"dir\\file.mp4",
			"..",
			"../up.mp4",
			"a/../b.mp4",
			"a/..",
		])
			expect(() => add(bad), bad).toThrow(/CHECK/);
		expect(() => add("copies/PXL_0001.mp4")).not.toThrow();
	});

	it("keeps one live location per path; a gone one stays as history", () => {
		const db = sample();
		const add = () =>
			db
				.prepare(
					`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
					 VALUES (?, 1, 'exports/film.mp4', 0, 1, 1)`,
				)
				.run(sha("e"));
		expect(add).toThrow(/UNIQUE/);
		db.exec(
			"UPDATE locations SET gone_run_id = 1 WHERE path = 'exports/film.mp4'",
		);
		expect(add).not.toThrow();
	});
});

describe("search", () => {
	it("finds titles, names and statements whatever their accents or case", () => {
		const db = sample();
		db.exec("UPDATE assets SET title = 'Plaza de la PEÑA' WHERE id = 2");
		const ids = (table: string, q: string) =>
			(
				db
					.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ?`)
					.all(q) as Array<{ rowid: number }>
			).map((r) => r.rowid);
		expect(ids("assets_text", "pena")).toEqual([2]);
		expect(ids("assets_text", "town")).toEqual([]);
		expect(ids("credits_text", "archive")).toEqual([2]);
		db.exec("DELETE FROM credits WHERE id = 2");
		expect(ids("credits_text", "archive")).toEqual([]);
		expect(ids("statements_text", "camera")).toEqual([1]);
	});
});

describe("opening rules", () => {
	it("calls a newer catalog newer and refuses it in words, changing nothing", () => {
		const db = track(memoryCatalog());
		db.exec(`PRAGMA user_version = ${CATALOG_FORMAT + 1}`);
		const state = inspectCatalog(db);
		expect(state).toEqual({ state: "newer", format: CATALOG_FORMAT + 1 });
		expect(refusalMessage(state)).toMatch(
			/Update Provenance Tracker to open it\. Nothing was changed\./,
		);
		expect(() =>
			upgradeCatalog(db, { backup: "copy.sqlite", tool: TEST_TOOL }),
		).toThrow(/Update Provenance Tracker/);
		expect(one(db, "PRAGMA user_version").user_version).toBe(
			CATALOG_FORMAT + 1,
		);
	});

	it("calls another program's database foreign", () => {
		const db = track(new DatabaseSync(":memory:"));
		db.exec("CREATE TABLE x (y TEXT); PRAGMA application_id = 42;");
		expect(inspectCatalog(db).state).toBe("foreign");
		expect(refusalMessage(inspectCatalog(db))).toMatch(/another program/);
		const plain = track(new DatabaseSync(":memory:"));
		plain.exec("CREATE TABLE x (y TEXT)");
		expect(refusalMessage(inspectCatalog(plain))).toMatch(
			/not a Provenance Tracker catalog/,
		);
	});
});

describe("upgrading", () => {
	// A made-up format 2, to test the machinery before a real one exists.
	const toV2 = [
		{
			from: 1,
			to: 2,
			sql: "ALTER TABLE roots ADD COLUMN colour TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 2;",
		},
	];

	it("has nothing to do on a current catalog", () => {
		const db = track(memoryCatalog());
		expect(
			upgradeCatalog(db, { backup: "copy.sqlite", tool: TEST_TOOL }),
		).toEqual([]);
		expect(UPGRADES).toHaveLength(CATALOG_FORMAT - 1);
	});

	it("applies each step in order and records where the copy was saved", () => {
		const db = sample();
		const applied = upgradeCatalog(db, {
			backup: "catalog.before-v2.sqlite",
			tool: TEST_TOOL,
			steps: toV2,
			target: 2,
			now: AT,
		});
		expect(applied).toEqual([{ from: 1, to: 2 }]);
		expect(one(db, "PRAGMA user_version").user_version).toBe(2);
		const run = one(
			db,
			"SELECT kind, summary FROM runs ORDER BY id DESC LIMIT 1",
		);
		expect(run.kind).toBe("upgrade");
		expect(JSON.parse(String(run.summary))).toEqual({
			from: 1,
			to: 2,
			backup: "catalog.before-v2.sqlite",
		});
	});

	it("will not start without a saved copy", () => {
		const db = sample();
		expect(() =>
			upgradeCatalog(db, {
				backup: " ",
				tool: TEST_TOOL,
				steps: toV2,
				target: 2,
			}),
		).toThrow(/Save a copy/);
		expect(one(db, "PRAGMA user_version").user_version).toBe(1);
	});

	it("rolls a failed step back, leaving the catalog as it was", () => {
		const db = sample();
		const runsBefore = one(db, "SELECT count(*) AS n FROM runs").n;
		const broken = [
			{
				from: 1,
				to: 2,
				sql: "ALTER TABLE roots ADD COLUMN colour TEXT; PRAGMA user_version = 2; SELECT * FROM no_such_table;",
			},
		];
		expect(() =>
			upgradeCatalog(db, {
				backup: "copy",
				tool: TEST_TOOL,
				steps: broken,
				target: 2,
			}),
		).toThrow(/no such table/);
		expect(one(db, "PRAGMA user_version").user_version).toBe(1);
		expect(
			one(
				db,
				"SELECT count(*) AS n FROM pragma_table_info('roots') WHERE name = 'colour'",
			).n,
		).toBe(0);
		expect(one(db, "SELECT count(*) AS n FROM runs").n).toBe(runsBefore);
	});

	it("refuses a step that does not reach the format it promises, and a missing step", () => {
		const db = sample();
		const liar = [{ from: 1, to: 2, sql: "SELECT 1;" }];
		expect(() =>
			upgradeCatalog(db, {
				backup: "copy",
				tool: TEST_TOOL,
				steps: liar,
				target: 2,
			}),
		).toThrow(/left the catalog at format 1/);
		expect(() =>
			upgradeCatalog(db, {
				backup: "copy",
				tool: TEST_TOOL,
				steps: [],
				target: 2,
			}),
		).toThrow(/No upgrade step from catalog format 1 to 2/);
	});
});

describe("the sample catalog of every format", () => {
	const files = readdirSync(SAMPLES).filter((f) => /^v\d+\.sqlite$/.test(f));

	it("exists for the current format", () => {
		expect(files).toContain(`v${CATALOG_FORMAT}.sqlite`);
	});

	for (const file of files)
		it(`${file} opens and upgrades to exactly the schema a new catalog gets`, () => {
			const dir = mkdtempSync(path.join(tmpdir(), "pt-catalog-"));
			temps.push(dir);
			const copy = path.join(dir, file);
			copyFileSync(path.join(SAMPLES, file), copy);
			const db = track(new DatabaseSync(copy));
			prepareConnection(db);
			const state = inspectCatalog(db);
			expect(["current", "older"]).toContain(state.state);
			upgradeCatalog(db, { backup: "test copy", tool: TEST_TOOL });
			expect(inspectCatalog(db)).toEqual({
				state: "current",
				format: CATALOG_FORMAT,
			});
			expect(one(db, "PRAGMA integrity_check").integrity_check).toBe("ok");
			expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
			// While the format is a draft this also says: rebuild the sample
			// (npm run catalog:write) when the SQL changes. Once it is released,
			// a change to the SQL must be a new format with an upgrade step.
			expect(
				schemaOf(db),
				`${file} schema (format ${CATALOG_FORMAT} is ${CATALOG_FORMAT_STATUS})`,
			).toEqual(schemaOf(track(memoryCatalog())));
			for (const table of dataTables(db))
				expect(
					Number(one(db, `SELECT count(*) AS n FROM "${table}"`).n),
					table,
				).toBeGreaterThan(0);
		});
});
