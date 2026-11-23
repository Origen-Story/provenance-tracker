import { describe, it, expect } from "vitest";
import { createRow, editRow } from "../../src/catalog/edit.ts";
import {
	assetRecord,
	ftsQuery,
	listAssets,
	projectSummary,
} from "../../src/catalog/read.ts";
import { PERSON, PROJECT_ID, sha } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";

const { catalog, sample } = catalogsForTests();

// The sample: 1 street interview (produced), 2 town square photo (archival),
// 3 title sequence (generated), 4 finished film (produced output, with a
// signed copy), linked camera → film.

describe("projectSummary", () => {
	it("gives the settings, counts by kind, and the newest run of each kind", () => {
		const db = sample();
		editRow(
			db,
			"assets",
			2,
			{ removed_at: "2026-11-22T10:00:00.000Z" },
			PERSON,
		);
		const s = projectSummary(db);
		expect(s.projectId).toBe(PROJECT_ID);
		expect(s.settings.name).toBe("Sample project");
		expect(Object.keys(s.settings)).toContain("code_prefix");
		expect(s.counts).toEqual({
			assets: 3,
			byKind: { generated: 1, produced: 2 },
			unsorted: 0,
			outputs: 1,
			removed: 1,
		});
		expect(s.lastRuns.map((r) => r.kind)).toEqual([
			"create",
			"extract",
			"import",
			"scan",
			"sign",
		]);
	});
});

describe("listAssets", () => {
	it("lists each asset with its current file, never a signed copy", () => {
		const { total, assets } = listAssets(sample());
		expect(total).toBe(4);
		expect(
			assets.map((a) => [
				a.id,
				a.kind,
				a.displayTitle,
				a.file?.path,
				a.versions,
			]),
		).toEqual([
			[1, "produced", "Street interview", "camera/PXL_0001.mp4", 1],
			[2, "archival", "Town square, 1910", "archive/square-1910.jpg", 1],
			[3, "generated", "Title sequence", "ai/title.mp4", 1],
			[4, "produced", "Finished film", "exports/film.mp4", 1],
		]);
		expect(assets[3]).toMatchObject({
			isOutput: true,
			file: { root: "media", sha256: sha("d"), size: 120_000_000 },
		});
	});

	it("names an untitled asset by its file", () => {
		const db = sample();
		editRow(db, "assets", 3, { title: "" }, PERSON);
		expect(listAssets(db).assets[2].displayTitle).toBe("title.mp4");
	});

	it("filters by spectrum position, counting a digital class marked AI-assisted as assisted", () => {
		const db = sample();
		const ids = (position: string) =>
			listAssets(db, { position }).assets.map((a) => a.id);
		expect(ids("captured")).toEqual([1, 2]);
		expect(ids("synthetic")).toEqual([3]);
		expect(ids("hybrid")).toEqual([4]);
		expect(ids("digital")).toEqual([]);
		editRow(db, "assets", 3, { origin_class: "digitalCreation" }, PERSON);
		expect(ids("digital")).toEqual([3]);
		editRow(db, "assets", 3, { ai_assisted: true }, PERSON);
		expect(ids("assisted")).toEqual([3]);
		expect(ids("digital")).toEqual([]);
		editRow(db, "assets", 2, { origin_class: "unknown" }, PERSON);
		editRow(db, "assets", 1, { origin_class: "notAClass" }, PERSON);
		expect(ids("unknown")).toEqual([1, 2]);
		expect(ids("nowhere")).toEqual([]);
	});

	it("filters by kind, class, outputs and removal", () => {
		const db = sample();
		const ids = (f: Parameters<typeof listAssets>[1]) =>
			listAssets(db, f).assets.map((a) => a.id);
		expect(ids({ kind: "produced" })).toEqual([1, 4]);
		expect(ids({ originClass: "trainedAlgorithmicMedia" })).toEqual([3]);
		expect(ids({ outputs: true })).toEqual([4]);
		editRow(
			db,
			"assets",
			1,
			{ removed_at: "2026-11-22T10:00:00.000Z" },
			PERSON,
		);
		expect(ids({})).toEqual([2, 3, 4]);
		expect(ids({ removed: true })).toEqual([1, 2, 3, 4]);
		expect(ids({ removed: "only" })).toEqual([1]);
	});

	it("finds words in titles and credits whatever their accents, and parts of file paths and codes", () => {
		const db = sample();
		editRow(
			db,
			"assets",
			1,
			{ title: "Entrevista con la Señora Peña", code: "DM-007" },
			PERSON,
		);
		const ids = (q: string) => listAssets(db, { q }).assets.map((a) => a.id);
		expect(ids("pena")).toEqual([1]);
		expect(ids("PEÑA señora")).toEqual([1]);
		expect(ids("photograph")).toEqual([2]); // a credit: "Unknown photographer"
		expect(ids("square-19")).toEqual([2]); // part of a path
		expect(ids("dm-00")).toEqual([1]); // part of a code
		// Query syntax and LIKE wildcards are only ever text.
		expect(ids('"')).toEqual([]);
		expect(ids("title OR NOT")).toEqual([]);
		expect(ids("%")).toEqual([]);
		// Only the one path with a real underscore (PXL_0001), not every path.
		expect(ids("_")).toEqual([1]);
	});

	it("pages with limit and offset", () => {
		const page = listAssets(sample(), { limit: 2, offset: 1 });
		expect(page.total).toBe(4);
		expect(page.assets.map((a) => a.id)).toEqual([2, 3]);
	});
});

describe("ftsQuery", () => {
	it("quotes each word and matches it as a prefix", () => {
		expect(ftsQuery('  Peña "OR" title  ')).toBe('"Peña"* "OR"* "title"*');
		expect(ftsQuery('  "" ')).toBeNull();
	});
});

describe("assetRecord", () => {
	it("gives everything known about one asset", () => {
		const r = assetRecord(sample(), 4)!;
		expect(r.fields).toMatchObject({
			kind: "produced",
			title: "Finished film",
			is_output: true,
			origin_ingredient_classes: [],
		});
		expect(r.contents.map((c) => [c.sha256, c.signedCopy, c.places])).toEqual([
			[
				sha("d"),
				false,
				[{ root: "media", path: "exports/film.mp4", live: true }],
			],
			[
				sha("e"),
				true,
				[
					{
						root: "media",
						path: "exports/signed/film.signed.v1.mp4",
						live: true,
					},
				],
			],
		]);
		expect(r.relationships).toEqual([
			{
				id: 1,
				direction: "parent",
				otherAssetId: 1,
				otherTitle: "Street interview",
				type: "output_of",
				matchMethod: "timeline",
				confidence: 1,
				note: "",
			},
		]);
		expect(r.timelines).toHaveLength(1);
		expect(r.statements.map((s) => s.author)).toEqual(["A. Maker"]);
		expect(r.signatures).toMatchObject([
			{
				kind: "output",
				version: 1,
				signedSha256: sha("e"),
				engine: "c2pa-node",
				timestamped: false,
			},
		]);
		expect(r.history[0]).toMatchObject({
			field: expect.any(String),
			actorKind: expect.any(String),
		});
	});

	it("shows the other side of a link from the parent, and the asset's readings, credits and generation", () => {
		const db = sample();
		const camera = assetRecord(db, 1)!;
		expect(camera.relationships[0]).toMatchObject({
			direction: "child",
			otherAssetId: 4,
			otherTitle: "Finished film",
		});
		expect(camera.contents[0].readings.length).toBeGreaterThan(0);
		expect(camera.contents[0].readings[0]).not.toHaveProperty("data");
		const photo = assetRecord(db, 2)!;
		expect(photo.credits.map((c) => c.name)).toEqual([
			"Unknown photographer",
			"Example Archive",
		]);
		expect(assetRecord(db, 3)!.generation).toMatchObject({
			model_name: "example-model",
		});
	});

	it("is null for an asset that is not there, and keeps history newest first", () => {
		const db = catalog();
		expect(assetRecord(db, 1)).toBeNull();
		const id = Number(
			createRow(db, "assets", { kind: "archival", title: "One" }, PERSON),
		);
		editRow(db, "assets", id, { title: "Two" }, PERSON);
		const h = assetRecord(db, id)!.history;
		expect(h[0]).toMatchObject({
			field: "title",
			oldValue: "One",
			newValue: "Two",
			actorKind: "person",
		});
	});
});
