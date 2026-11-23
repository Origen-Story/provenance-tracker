import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createRow, type Actor } from "../../src/catalog/edit.ts";
import {
	addCredit,
	editAsset,
	EditError,
	editCredit,
	editSettings,
	linkAssets,
	NotFoundError,
	removeCredit,
	setGeneration,
	setRemoved,
	unlink,
	type PersonEdit,
} from "../../src/catalog/edits.ts";
import { finishRun, startRun } from "../../src/catalog/runs.ts";
import { PERSON, TEST_TOOL, sha } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";

const { catalog } = catalogsForTests();
const AT = "2026-11-23T12:00:00.000Z";
const ME: PersonEdit = {
	actor: PERSON.actor as Actor,
	tool: TEST_TOOL,
	now: AT,
};

function withAsset(values: Record<string, unknown> = {}) {
	const db = catalog();
	const id = Number(
		createRow(
			db,
			"assets",
			{ kind: "produced", title: "Interview", ...values },
			PERSON,
		),
	);
	return { db, id };
}
const row = (
	db: DatabaseSync,
	table: string,
	id: number | string,
	key = "id",
) =>
	db.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(id) as Record<
		string,
		unknown
	>;
const historyOf = (db: DatabaseSync, table: string, key: number | string) =>
	db
		.prepare(
			"SELECT actor_kind, actor, field, new_value, note FROM history WHERE table_name = ? AND row_key = ? ORDER BY id",
		)
		.all(table, String(key)) as Array<Record<string, unknown>>;

describe("editAsset", () => {
	it("changes a person's fields with history under their name and note", () => {
		const { db, id } = withAsset();
		expect(
			editAsset(
				db,
				id,
				{ title: "Street interview", caption: "Day one" },
				{ ...ME, note: "typo" },
			),
		).toEqual(["title", "caption"]);
		expect(row(db, "assets", id)).toMatchObject({
			title: "Street interview",
			title_folded: "street interview",
			caption: "Day one",
		});
		expect(historyOf(db, "assets", id).at(-1)).toMatchObject({
			actor_kind: "person",
			actor: "A. Maker",
			field: "caption",
			note: "typo",
		});
	});

	it("refuses fields a person does not set, unknown kinds and wrong types, in words", () => {
		const { db, id } = withAsset();
		expect(() =>
			editAsset(db, id, { signed_by: "creator", updated_at: "x" }, ME),
		).toThrow(
			new EditError(
				"An asset has no fields signed_by, updated_at that can be set",
			),
		);
		expect(() => editAsset(db, id, { kind: "video" }, ME)).toThrow(
			/kind must be one of unsorted, generated, archival, produced, sidecar/,
		);
		expect(() => editAsset(db, id, { title: 5 }, ME)).toThrow(EditError);
		expect(() => editAsset(db, 999, { title: "x" }, ME)).toThrow(NotFoundError);
	});

	it("makes a class set by hand the person's, confirmed unless they say not, and cleans the public title and note", () => {
		const { db, id } = withAsset();
		editAsset(
			db,
			id,
			{
				origin_class: "screenCapture",
				public_title: "  The\tinterview\n ",
				origin_class_note: `  ${"x".repeat(2100)}`,
			},
			ME,
		);
		expect(row(db, "assets", id)).toMatchObject({
			origin_class: "screenCapture",
			origin_class_source: "user",
			origin_class_confirmed: 1,
			public_title: "The interview",
		});
		expect(String(row(db, "assets", id).origin_class_note)).toHaveLength(2000);
		editAsset(
			db,
			id,
			{ origin_class: "digitalCapture", origin_class_confirmed: false },
			ME,
		);
		expect(row(db, "assets", id)).toMatchObject({
			origin_class: "digitalCapture",
			origin_class_confirmed: 0,
		});
		expect(() => editAsset(db, id, { origin_class: "photo" }, ME)).toThrow(
			/Unknown origin class/,
		);
		expect(() =>
			editAsset(db, id, { origin_ingredient_classes: ["photo"] }, ME),
		).toThrow(/list of origin classes/);
	});

	it('keeps "AI-assisted" only for digital work', () => {
		const { db, id } = withAsset({ origin_class: "digitalCreation" });
		editAsset(db, id, { ai_assisted: true }, ME);
		expect(row(db, "assets", id).ai_assisted).toBe(1);
		editAsset(db, id, { origin_class: "digitalCapture" }, ME);
		expect(row(db, "assets", id).ai_assisted).toBe(0);
		expect(() => editAsset(db, id, { ai_assisted: true }, ME)).toThrow(
			/applies only to digital work/,
		);
	});

	it("classifies the assets derived from it again, so an upscale follows its source", () => {
		const { db, id: source } = withAsset({
			kind: "generated",
			origin_class: "unknown",
		});
		const run = startRun(db, { kind: "scan", tool: TEST_TOOL, now: AT });
		const tool: Actor = { kind: "tool", name: "t", runId: run };
		const upscale = Number(
			createRow(db, "assets", { kind: "unsorted" }, { actor: tool, now: AT }),
		);
		createRow(
			db,
			"contents",
			{ sha256: sha("a"), size: 1, asset_id: upscale, first_run_id: run },
			{ actor: tool, now: AT },
		);
		db.prepare(
			"INSERT INTO observations (content_sha256, run_id, kind, extractor, extractor_version, status, data, observed_at) VALUES (?, ?, 'exif', 'exiftool', '13', 'ok', ?, ?)",
		).run(
			sha("a"),
			run,
			JSON.stringify({ Software: "Topaz Gigapixel 8.0" }),
			AT,
		);
		finishRun(db, run, { outcome: "ok", now: AT });

		linkAssets(
			db,
			{ parent_id: source, child_id: upscale, type: "derived_from" },
			ME,
		);
		// Its source's class is not known yet, so neither is the upscale's.
		expect(row(db, "assets", upscale)).toMatchObject({
			origin_class: "unknown",
			origin_class_source: "",
		});
		editAsset(db, source, { origin_class: "trainedAlgorithmicMedia" }, ME);
		expect(row(db, "assets", upscale)).toMatchObject({
			origin_class: "trainedAlgorithmicMedia",
			origin_class_source: "modifier_of_generated",
		});
		expect(
			db
				.prepare("SELECT count(*) AS n FROM runs WHERE kind = 'classify'")
				.get(),
		).toEqual({ n: 2 });
	});
});

describe("setRemoved", () => {
	it("marks an asset removed and brings it back, never deleting it", () => {
		const { db, id } = withAsset();
		setRemoved(db, id, true, ME);
		expect(row(db, "assets", id).removed_at).toBe(AT);
		setRemoved(db, id, true, ME); // already: nothing written
		setRemoved(db, id, false, ME);
		expect(row(db, "assets", id).removed_at).toBeNull();
		expect(
			historyOf(db, "assets", id).filter((h) => h.field === "removed_at"),
		).toHaveLength(2);
	});
});

describe("credits", () => {
	it("adds, changes and removes a credit, the person adding it being who says so", () => {
		const { db, id } = withAsset();
		const c = addCredit(db, id, { role: "camera", name: "A. Camera" }, ME);
		const d = addCredit(db, id, { role: "sound", name: "B. Sound" }, ME);
		expect(row(db, "credits", c)).toMatchObject({
			role: "camera",
			name: "A. Camera",
			stated_by: "A. Maker",
			sort_order: 0,
		});
		expect(row(db, "credits", d).sort_order).toBe(1);
		expect(editCredit(db, id, c, { name: "A. Camerawoman" }, ME)).toEqual([
			"name",
		]);
		removeCredit(db, id, d, ME);
		expect(db.prepare("SELECT id FROM credits").all()).toEqual([{ id: c }]);
		expect(() => addCredit(db, id, { role: "camera" }, ME)).toThrow(
			/needs a name/,
		);
		expect(() =>
			addCredit(
				db,
				id,
				{ role: "x", name: "y", stated_by: "someone else" },
				ME,
			),
		).toThrow(/no field stated_by/);
		const other = Number(createRow(db, "assets", { kind: "produced" }, PERSON));
		expect(() => editCredit(db, other, c, { name: "x" }, ME)).toThrow(
			NotFoundError,
		);
	});
});

describe("setGeneration", () => {
	it("makes an AI asset's generation details, then changes them", () => {
		const { db, id } = withAsset({ kind: "generated" });
		setGeneration(
			db,
			id,
			{ platform: "example", prompt: "a door", steps: 20 },
			ME,
		);
		expect(row(db, "generation", id, "asset_id")).toMatchObject({
			platform: "example",
			prompt: "a door",
			steps: 20,
		});
		expect(setGeneration(db, id, { prompt: "a wooden door" }, ME)).toEqual([
			"prompt",
		]);
		expect(() => setGeneration(db, id, { steps: "many" }, ME)).toThrow(
			EditError,
		);
		expect(() => setGeneration(db, id, { asset_id: 2 }, ME)).toThrow(
			/no field asset_id/,
		);
	});
});

describe("links", () => {
	it("links two assets once, refuses nonsense, and unlinks", () => {
		const { db, id: a } = withAsset();
		const b = Number(
			createRow(db, "assets", { kind: "produced", is_output: true }, PERSON),
		);
		const link = linkAssets(
			db,
			{ parent_id: a, child_id: b, type: "output_of", note: "used in the cut" },
			ME,
		);
		expect(
			linkAssets(db, { parent_id: a, child_id: b, type: "output_of" }, ME),
		).toBe(link);
		expect(row(db, "relationships", link)).toMatchObject({
			parent_id: a,
			child_id: b,
			type: "output_of",
			match_method: "manual",
			confidence: 1,
			note: "used in the cut",
		});
		expect(() =>
			linkAssets(db, { parent_id: a, child_id: a, type: "ingredient" }, ME),
		).toThrow(/itself/);
		expect(() =>
			linkAssets(db, { parent_id: a, child_id: b, type: "sidecar_of" }, ME),
		).toThrow(/type is one of ingredient, derived_from, output_of/);
		expect(() =>
			linkAssets(db, { parent_id: a, child_id: 99, type: "ingredient" }, ME),
		).toThrow(NotFoundError);
		unlink(db, link, ME);
		expect(db.prepare("SELECT count(*) AS n FROM relationships").get()).toEqual(
			{ n: 0 },
		);
		expect(() => unlink(db, link, ME)).toThrow(NotFoundError);
	});
});

describe("editSettings", () => {
	it("changes the project's settings, and refuses others or an empty name", () => {
		const { db } = withAsset();
		expect(
			editSettings(
				db,
				{ name: " Film ", author: "A. Maker", description: "" },
				ME,
			),
		).toEqual(["name", "author"]);
		expect(row(db, "meta", "name", "key").value).toBe("Film");
		expect(() => editSettings(db, { project_id: "x" }, ME)).toThrow(
			/no field project_id/,
		);
		expect(() => editSettings(db, { name: "  " }, ME)).toThrow(/needs a name/);
		expect(() => editSettings(db, { author: 5 }, ME)).toThrow(/takes text/);
	});
});
