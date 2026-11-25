import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createRow, type Actor } from "../../src/catalog/edit.ts";
import {
	EditError,
	linkAssets,
	setEditRelation,
	startFromEdit,
	type PersonEdit,
} from "../../src/catalog/edits.ts";
import { revisionsOf } from "../../src/catalog/revisions.ts";
import { startedFrom } from "../../src/catalog/timelines.ts";
import { editStem, suggestEarlierEdit } from "../../src/files/edit-names.ts";
import { PERSON, TEST_TOOL, sha } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";

const { sample } = catalogsForTests();
const ME: PersonEdit = {
	actor: PERSON.actor as Actor,
	tool: TEST_TOOL,
	now: "2026-11-25T12:00:00.000Z",
};

/** A finished edit with a file of its own, as a scan and a person would make it. */
function edit(db: DatabaseSync, title: string, c: string, path: string) {
	const id = Number(
		createRow(
			db,
			"assets",
			{ kind: "produced", is_output: true, title },
			PERSON,
		),
	);
	addFile(db, id, c, path);
	return id;
}
function addFile(db: DatabaseSync, assetId: number, c: string, path: string) {
	createRow(
		db,
		"contents",
		{ sha256: sha(c), size: 1000, asset_id: assetId, first_run_id: 1 },
		PERSON,
	);
	db.prepare(
		`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
		 VALUES (?, 1, ?, 0, 1, 1)`,
	).run(sha(c), path);
}

/**
 * The sample's film (signed once, published) as V1; V2 and V3 its next
 * revisions; V2b a branch from V1; a trailer made from V3.
 */
function family() {
	const db = sample();
	const v1 = Number(
		(
			db.prepare("SELECT asset_id FROM signatures LIMIT 1").get() as {
				asset_id: number;
			}
		).asset_id,
	);
	const v2 = edit(db, "Film v2", "1", "exports/film_v2.mp4");
	startFromEdit(db, v2, v1, ME);
	const v3 = edit(db, "Film v3", "2", "exports/film_v3.mp4");
	startFromEdit(db, v3, v2, ME);
	const v2b = edit(db, "Film v2, festival", "3", "exports/film_v2b.mp4");
	startFromEdit(db, v2b, v1, ME);
	const trailer = edit(db, "Trailer", "4", "exports/trailer.mp4");
	startFromEdit(db, trailer, v3, ME, "made_from");
	return { db, v1, v2, v3, v2b, trailer };
}

describe("revisionsOf (D60)", () => {
	it("lays out the revisions earliest first, branches after their parent, with what is signed and published", () => {
		const { db, v1, v2, v3, v2b } = family();
		const r = revisionsOf(db, v3);
		expect(r.line.map((e) => [e.assetId, e.depth, e.current])).toEqual([
			[v1, 0, false],
			[v2, 1, false],
			[v3, 2, true],
			[v2b, 1, false],
		]);
		expect(r.line[0]).toMatchObject({ signed: 1, published: 1 });
		expect(r.line[2]).toMatchObject({
			title: "Film v3",
			fileName: "film_v3.mp4",
			signed: 0,
			published: 0,
		});
		// The same line from any edit in it.
		expect(revisionsOf(db, v2b).line.map((e) => e.assetId)).toEqual([
			v1,
			v2,
			v3,
			v2b,
		]);
	});

	it("keeps what was made from an edit out of its line, and shows it both ways", () => {
		const { db, v3, trailer } = family();
		expect(revisionsOf(db, v3).deliverables.map((e) => e.title)).toEqual([
			"Trailer",
		]);
		const t = revisionsOf(db, trailer);
		expect(t.madeFrom?.assetId).toBe(v3);
		expect(t.line.map((e) => e.assetId)).toEqual([trailer]);
		// Its clip classes still carry from the edit it was made from.
		expect(startedFrom(db, trailer)).toBe(v3);
	});

	it("shows an edit's re-renders at the same place, oldest first", () => {
		const { db, v3 } = family();
		// A re-render replaces the file at that path, as a scan records it.
		db.exec(
			"UPDATE locations SET gone_run_id = 1 WHERE path = 'exports/film_v3.mp4'",
		);
		addFile(db, v3, "5", "exports/film_v3.mp4");
		const r = revisionsOf(db, v3);
		expect(r.renders.map((c) => c.sha256)).toEqual([sha("2"), sha("5")]);
		expect(r.renders.every((c) => c.signedVersions.length === 0)).toBe(true);
	});

	it("survives two edits that point at each other", () => {
		const { db, v1, v2 } = family();
		linkAssets(db, { parent_id: v2, child_id: v1, type: "made_from" }, ME);
		db.exec(
			`UPDATE relationships SET type = 'started_from' WHERE parent_id = ${v2} AND child_id = ${v1}`,
		);
		expect(revisionsOf(db, v1).line.length).toBeGreaterThan(0);
		// Written around edit.ts on purpose; put back so the catalog verifies.
		db.exec(
			`UPDATE relationships SET type = 'made_from' WHERE parent_id = ${v2} AND child_id = ${v1}`,
		);
	});
});

describe("setEditRelation (D60)", () => {
	it("turns a trailer into a revision and back, with history", () => {
		const { db, v3, trailer } = family();
		setEditRelation(db, trailer, "revision", ME);
		expect(revisionsOf(db, v3).line.map((e) => e.assetId)).toContain(trailer);
		expect(revisionsOf(db, v3).deliverables).toEqual([]);
		setEditRelation(db, trailer, "made_from", ME);
		const changes = db
			.prepare(
				`SELECT h.new_value FROM history h JOIN relationships r ON h.row_key = CAST(r.id AS TEXT)
				 WHERE h.table_name = 'relationships' AND h.field = 'type' AND r.child_id = ? ORDER BY h.id`,
			)
			.all(trailer) as Array<{ new_value: string }>;
		expect(changes.map((c) => c.new_value)).toEqual([
			'"made_from"',
			'"started_from"',
			'"made_from"',
		]);
	});

	it("refuses an unknown relation, and an edit that started from nothing", () => {
		const { db, v1, trailer } = family();
		expect(() => setEditRelation(db, trailer, "sibling", ME)).toThrow(
			EditError,
		);
		expect(() => setEditRelation(db, v1, "revision", ME)).toThrow(
			/did not start from another/,
		);
		expect(() =>
			startFromEdit(db, edit(db, "X", "6", "x.mp4"), v1, ME, "cousin" as never),
		).toThrow(/next revision/);
	});
});

describe("suggestEarlierEdit (D60)", () => {
	it("sets versions and extensions aside", () => {
		expect(editStem("tracker-demo-RoughCutV1_1.mp4")).toBe(
			"tracker demo roughcut",
		);
		expect(editStem("tracker-demo-RoughCutV2.mp4")).toBe(
			"tracker demo roughcut",
		);
		expect(editStem("film_v12.mov")).toBe("film");
		expect(editStem("Film v11.mp4")).toBe("film");
		expect(editStem("Market (2).mp4")).toBe("market");
		expect(editStem("morning-market-final.mp4")).toBe("morning market");
		expect(editStem("film.signed.v2.mp4")).toBe("film");
	});

	it("offers the newest earlier edit with the same name, or none", () => {
		const earlier = [
			{ id: 3, fileName: "film_v10.mp4" },
			{ id: 7, fileName: "film_v11.mp4" },
			{ id: 9, fileName: "trailer.mp4" },
		];
		expect(suggestEarlierEdit("film_v12.mp4", earlier)).toBe(7);
		expect(suggestEarlierEdit("vertical.mp4", earlier)).toBeNull();
		expect(suggestEarlierEdit("", earlier)).toBeNull();
	});
});
