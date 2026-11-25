import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createRow, editRow } from "../../src/catalog/edit.ts";
import {
	cachedBreakdown,
	differences,
	findOrphans,
	legacyIds,
	legacyRefs,
	recomputeBreakdown,
	signatureForExport,
	tableDifferences,
} from "../../src/legacy/checks.ts";
import { parseCopyText } from "../../src/legacy/copy-text.ts";
import { planProject } from "../../src/legacy/plan.ts";
import { writeMigration, type FileFact } from "../../src/legacy/write.ts";
import { buildPublicExport } from "../../src/manifest/public-export.js";
import { computeBreakdown } from "../../src/timeline/breakdown.js";
import { PERSON, TEST_TOOL } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";
import type { DumpRow } from "../helpers/legacy-dump.ts";
import { FILES, fixtureText } from "./fixture.ts";

const { catalog } = catalogsForTests();

/** A statement the public export can be built from (version 2, with a composition). */
const STATEMENT_V2 = JSON.stringify({
	version: 2,
	text: "Made from a recording and one generated image.",
	author: "An Editor",
	output: {
		title: "cut.mp4",
		originClass: "compositeSynthetic",
		durationSeconds: 10,
		fps: 25,
	},
	composition: { picture: { intervals: [] }, audio: { intervals: [] } },
	ingredients: [],
});

function migrated(change?: (rows: Record<string, DumpRow[]>) => void) {
	const db = catalog();
	const rootId = Number(
		createRow(
			db,
			"roots",
			{ name: "media", folder_in_project: "media" },
			PERSON,
		),
	);
	const facts = (p: string): FileFact => {
		const f = Object.values(FILES).find((x) => x.path === p);
		if (!f) return { found: false, reason: "not here" };
		return {
			found: true,
			rootId,
			path: p.replaceAll("\\", "/").replace(/^P:\/media\//, ""),
			sha256: f.sha256,
			size: f.size,
			modifiedMs: 1,
		};
	};
	const plan = planProject(parseCopyText(fixtureText(change)), 1);
	const result = writeMigration(db, plan, {
		facts,
		timelineFiles: () => true,
		source: { dumpFile: "x.dump", dumpSha256: "9".repeat(64) },
		tool: TEST_TOOL,
	});
	return { db, result };
}

/** The fixture's clips as the app fed them to computeBreakdown (timelines.js). */
function appSegments() {
	const base = { enabled: true, sourceKind: "file", aiAssisted: false };
	return [
		{
			...base,
			id: 10,
			clipId: "clipitem-1",
			name: "rec.wav",
			trackKind: "video",
			trackIndex: 1,
			startFrame: 0,
			endFrame: 50,
			inFrame: 0,
			outFrame: 50,
			sourceKey: "file-1",
			sourceName: "rec.wav",
			matchedAssetRef: "produced:1",
			matched: true,
			originClass: "digitalCapture",
		},
		{
			...base,
			id: 11,
			clipId: "clipitem-2",
			name: "rec.wav",
			trackKind: "audio",
			trackIndex: 1,
			startFrame: 50,
			endFrame: 100,
			inFrame: 0,
			outFrame: 0,
			sourceKey: "file-1",
			sourceName: "rec.wav",
			matchedAssetRef: "produced:1",
			matched: true,
			originClass: "digitalCapture",
		},
		{
			...base,
			id: 12,
			clipId: "clipitem-3",
			name: "gen.png",
			trackKind: "video",
			trackIndex: 1,
			startFrame: 100,
			endFrame: 250,
			inFrame: null,
			outFrame: null,
			sourceKey: "file-2",
			sourceName: "gen.png",
			matchedAssetRef: "ai:1",
			matched: true,
			originClass: "algorithmicMedia",
		},
		{
			...base,
			id: 13,
			clipId: "clipitem-4",
			name: "",
			trackKind: "video",
			trackIndex: 1,
			startFrame: 0,
			endFrame: 25,
			inFrame: 0,
			outFrame: 0,
			sourceKind: "generator",
			sourceKey: "gen-slug",
			sourceName: "",
			matchedAssetRef: null,
			matched: false,
			originClass: null,
		},
	];
}
const OPTIONS = {
	durationFrames: 250,
	fps: 25,
	primaryTrackIndex: 2,
	includeOverlays: false,
};
const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("findOrphans", () => {
	it("finds nothing in a whole database", () => {
		expect(findOrphans(parseCopyText(fixtureText()))).toEqual([]);
	});

	it("finds rows that belong to nothing", () => {
		const tables = parseCopyText(
			fixtureText((rows) => {
				rows["public.assets"].push({
					id: 2,
					project_id: null,
					asset_id: "X-1",
					file_path: "P:/x.png",
				});
				rows["public.archival_assets"].push({
					id: 2,
					project_id: 9,
					file_path: "P:/y.jpg",
				});
				rows["public.asset_relationships"].push({
					id: 3,
					parent_asset_type: "ai",
					parent_asset_id: 99,
					child_asset_type: "produced",
					child_asset_id: 2,
					relationship_type: "ingredient",
				});
				rows["public.asset_metadata"].push({
					id: 8,
					asset_id: 42,
					metadata_type: "exif",
					raw_json: "{}",
					extracted_at: "2026-11-01 09:00:00+01",
				});
				rows["public.timeline_segments"].push({
					id: 20,
					timeline_id: 77,
					start_frame: 0,
					end_frame: 1,
					source_key: "k",
				});
			}),
		);
		expect(findOrphans(tables)).toEqual([
			"public.assets 2 belongs to no project",
			"public.archival_assets 2 belongs to project 9, which is not there",
			"public.asset_relationships 3 names ai:99, which is not there",
			"public.asset_metadata 8 names ai:42, which is not there",
			"public.timeline_segments 20 belongs to timeline 77, which is not there",
		]);
	});
});

describe("where each catalog row came from", () => {
	it("is kept in the migrate run's summary, for every row it wrote", () => {
		const { db, result } = migrated();
		expect(legacyRefs(db, result.runId)).toEqual(
			new Map([
				[1, "ai:1"],
				[2, "archival:1"],
				[3, "produced:1"],
				[4, "produced:2"],
			]),
		);
		expect([...legacyIds(db, "signatures", result.runId)]).toEqual([
			[1, { legacy: "public.signatures", id: 8 }],
		]);
		expect([...legacyIds(db, "statements", result.runId)]).toEqual([
			[1, { legacy: "public.creator_statements", id: 5 }],
		]);
		// The timeline's settings other than primary_track_index are defaults, so its history alone could not say.
		expect([...legacyIds(db, "timelines", result.runId)]).toEqual([
			[1, { legacy: "public.timelines", id: 4 }],
		]);
		expect(
			[...legacyIds(db, "timeline_clips", result.runId)].map(([, e]) => e.id),
		).toEqual([10, 11, 12, 13]);
		expect(
			[...legacyIds(db, "relationships", result.runId)].map(([, e]) => e.id),
		).toEqual([1, 2]);
		const summary = JSON.parse(
			(
				db
					.prepare("SELECT summary FROM runs WHERE id = ?")
					.get(result.runId) as { summary: string }
			).summary,
		);
		expect(summary.origins.assets).toEqual({
			"1": "public.assets:1",
			"2": "public.archival_assets:1",
			"3": "public.produced_assets:1",
			"4": "public.produced_assets:2",
		});
		expect(result.origins).toEqual(summary.origins);
	});

	it("is read only from a migrate run", () => {
		const { db } = migrated();
		expect(() => legacyIds(db, "assets", 1)).toThrow(/not a migration/);
	});
});

describe("recomputeBreakdown", () => {
	it("gives what the app computed from the same clips, with Postgres's refs and segment ids", () => {
		const { db, result } = migrated();
		expect(roundTrip(recomputeBreakdown(db, 1, result.runId))).toEqual(
			roundTrip(computeBreakdown(appSegments(), OPTIONS)),
		);
	});

	it("follows the catalog: an asset's new class changes its clips, but not one with its own class", () => {
		const { db, result } = migrated();
		editRow(db, "assets", 3, { origin_class: "screenCapture" }, PERSON);
		editRow(db, "assets", 1, { origin_class: "digitalCapture" }, PERSON);
		const segs = appSegments().map((s) =>
			s.matchedAssetRef === "produced:1"
				? { ...s, originClass: "screenCapture" }
				: s,
		);
		expect(roundTrip(recomputeBreakdown(db, 1, result.runId))).toEqual(
			roundTrip(computeBreakdown(segs, OPTIONS)),
		);
	});
});

describe("cachedBreakdown", () => {
	type Layer = Record<string, unknown>;
	type Lane = {
		intervals?: Array<{ layers?: Layer[] }>;
		tracks?: Array<{ clips?: Layer[] }>;
	} | null;
	const layersOf = (b: { composition: Record<string, Lane> }) =>
		Object.values(b.composition).flatMap((lane) => [
			...(lane?.intervals ?? []).flatMap((iv) => iv.layers ?? []),
			...(lane?.tracks ?? []).flatMap((t) => t.clips ?? []),
		]);

	it("reads a cache from before asset refs as the app does, deriving each ref", () => {
		const now = roundTrip(computeBreakdown(appSegments(), OPTIONS));
		const old = roundTrip(now);
		for (const layer of layersOf(old)) {
			const [type, id] = String(layer.matchedAssetRef ?? ":").split(":");
			delete layer.matchedAssetRef;
			layer.matchedAssetType = type || null;
			layer.matchedAssetId = id ? Number(id) : null;
		}
		expect(layersOf(old).length).toBeGreaterThan(0);
		expect(cachedBreakdown(JSON.stringify(old))).toEqual({
			breakdown: now,
			oldShape: true,
		});
		expect(cachedBreakdown(JSON.stringify(now))).toEqual({
			breakdown: now,
			oldShape: false,
		});
	});

	it("still shows a ref that the old fields no longer give", () => {
		const now = roundTrip(computeBreakdown(appSegments(), OPTIONS));
		const old = roundTrip(now);
		for (const layer of layersOf(old)) {
			delete layer.matchedAssetRef;
			layer.matchedAssetType = "archival";
			layer.matchedAssetId = 1;
		}
		expect(
			differences(cachedBreakdown(JSON.stringify(old)).breakdown, now).length,
		).toBeGreaterThan(0);
	});

	it("reads an empty cache as null", () => {
		expect(cachedBreakdown(null)).toEqual({ breakdown: null, oldShape: false });
	});
});

describe("signatureForExport", () => {
	it("gives the export builder the same signing the app's row gave it, byte for byte", () => {
		const { db } = migrated((rows) => {
			rows["public.signatures"][0].statement_json = STATEMENT_V2;
		});
		const fromCatalog = signatureForExport(db, 1);
		expect(fromCatalog).toEqual({
			kind: "output",
			version: 1,
			statementJson: STATEMENT_V2,
			reportJson: '{"validation_state":"Valid"}',
			definitionJson: '{"title":"cut.mp4"}',
			signedPath: "exports/cut.signed.v1.mp4",
			signedHash: FILES.signed.sha256,
			signedSize: FILES.signed.size,
			createdAt: "2026-11-06T09:00:00.250Z",
		});
		// The app's row, as node-postgres returned it.
		const fromApp = {
			kind: "output",
			version: 1,
			statementJson: STATEMENT_V2,
			reportJson: '{"validation_state":"Valid"}',
			signedPath: FILES.signed.path,
			signedHash: FILES.signed.sha256,
			signedSize: FILES.signed.size,
			createdAt: new Date("2026-11-06T09:00:00.250Z"),
		};
		const stamp = {
			generatedAt: "2000-01-01T00:00:00.000Z",
			generator: { name: "t", version: "0" },
		};
		const a = JSON.stringify(
			buildPublicExport({ signature: fromApp, ...stamp }),
		);
		const b = JSON.stringify(
			buildPublicExport({ signature: fromCatalog, ...stamp }),
		);
		expect(b).toBe(a);
	});
});

describe("differences", () => {
	it("lists the paths where two values differ, up to a limit", () => {
		expect(
			differences({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }),
		).toEqual([]);
		expect(
			differences({ a: 1, b: { c: [1, 2] }, d: 1 }, { a: 2, b: { c: [1, 3] } }),
		).toEqual(["a", "b.c.1", "d"]);
		expect(differences(1, "1")).toEqual(["(the whole value)"]);
		expect(differences([1], { 0: 1 })).toEqual(["(the whole value)"]);
		expect(differences({ a: 1, b: 2, c: 3 }, {}, 2)).toEqual(["a", "b"]);
	});
});

describe("tableDifferences", () => {
	it("sees no difference in data dumped twice, whatever the comments and tokens say", () => {
		const a = parseCopyText(fixtureText());
		const b = parseCopyText(
			`\\restrict abc\n-- dumped again\n${fixtureText()}\\unrestrict abc\n`,
		);
		expect(tableDifferences(a, b)).toEqual([]);
	});

	it("names each row added, gone or changed, and tables or columns that differ", () => {
		const a = parseCopyText(fixtureText());
		const b = parseCopyText(
			fixtureText((rows) => {
				rows["public.creator_statements"][0].author_name = "Someone Else";
				rows["public.asset_relationships"].pop();
				rows["public.projects"].push({ id: 3, name: "New project" });
			}),
		);
		expect(tableDifferences(a, b)).toEqual([
			"public.projects id 3 was added",
			"public.asset_relationships id 2 is gone",
			"public.creator_statements id 5 changed",
		]);
		const fewer = new Map(a);
		fewer.delete("public.manifests");
		expect(tableDifferences(a, fewer)).toEqual([
			"public.manifests is only in the first dump",
		]);
		const other = new Map(a);
		other.set("public.manifests", {
			...a.get("public.manifests")!,
			columns: ["id"],
		});
		expect(tableDifferences(a, other)).toEqual([
			"public.manifests has different columns",
		]);
	});
});

export type { DatabaseSync };
