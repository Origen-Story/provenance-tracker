import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createRow } from "../../src/catalog/edit.ts";
import { parseCopyText } from "../../src/legacy/copy-text.ts";
import { planProject, type MigrationPlan } from "../../src/legacy/plan.ts";
import {
	fileProblems,
	LEGACY_ACTOR_NAME,
	writeMigration,
	type FileFact,
} from "../../src/legacy/write.ts";
import { PERSON, TEST_TOOL } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";
import { FILES, fixtureText } from "./fixture.ts";

const { catalog } = catalogsForTests();
const NOW = "2026-11-23T10:00:00.000Z";
const SOURCE = {
	dumpFile: "app_2026-11-21_223001.dump",
	dumpSha256: "9".repeat(64),
};

type Row = Record<string, unknown>;
const all = (db: DatabaseSync, sql: string, ...p: Array<string | number>) =>
	db.prepare(sql).all(...p) as Row[];
const one = (db: DatabaseSync, sql: string, ...p: Array<string | number>) =>
	db.prepare(sql).get(...p) as Row;

/** A catalog with one root, "media", for P:/media. */
function setUp() {
	const db = catalog();
	const rootId = Number(
		createRow(
			db,
			"roots",
			{ name: "media", folder_in_project: "media" },
			PERSON,
		),
	);
	return { db, rootId };
}

/** Every fixture file found where Postgres says, under the media root. */
function factsFor(
	rootId: number,
	missing: string[] = [],
	changed: Record<string, string> = {},
) {
	const byPath = new Map(Object.values(FILES).map((f) => [f.path, f]));
	return (p: string): FileFact => {
		const f = byPath.get(p);
		if (!f || missing.includes(p))
			return { found: false, reason: "not on this machine" };
		const rel = p.replaceAll("\\", "/").replace(/^P:\/media\//, "");
		return {
			found: true,
			rootId,
			path: rel,
			sha256: changed[p] ?? f.sha256,
			size: f.size,
			modifiedMs: 1_700_000_000_000,
		};
	};
}

const plan = (text = fixtureText()): MigrationPlan =>
	planProject(parseCopyText(text), 1);

function migrate(
	db: DatabaseSync,
	rootId: number,
	p = plan(),
	facts = factsFor(rootId),
) {
	return writeMigration(db, p, {
		facts,
		timelineFiles: (s) => s === FILES.timeline.sha256,
		source: SOURCE,
		tool: TEST_TOOL,
		now: () => NOW,
	});
}

describe("writeMigration", () => {
	it("writes every asset, file, link, statement, signing and timeline", () => {
		const { db, rootId } = setUp();
		const result = migrate(db, rootId);
		expect(result.counts).toEqual({
			assets: 4,
			contents: 5,
			locations: 5,
			credits: 3,
			generation: 1,
			observations: 3,
			relationships: 2,
			statements: 1,
			signatures: 1,
			timelines: 1,
			timeline_sources: 3,
			timeline_clips: 4,
		});
		expect(result.notFound).toEqual([]);
		expect([...result.assetIds.keys()]).toEqual([
			"ai:1",
			"archival:1",
			"produced:1",
			"produced:2",
		]);

		const run = one(
			db,
			"SELECT kind, tool, outcome, summary FROM runs WHERE id = ?",
			result.runId,
		);
		expect(run).toMatchObject({
			kind: "migrate",
			tool: TEST_TOOL.name,
			outcome: "ok",
		});
		expect(JSON.parse(run.summary as string)).toMatchObject({
			legacy_project: 1,
			dump_file: SOURCE.dumpFile,
		});

		const assets = all(
			db,
			"SELECT id, code, kind, title, is_output, origin_class, created_at, updated_at FROM assets ORDER BY id",
		);
		expect(assets).toEqual([
			{
				id: 1,
				code: "DM-001",
				kind: "generated",
				title: "",
				is_output: 0,
				origin_class: "trainedAlgorithmicMedia",
				created_at: "2026-11-01T08:00:00.000Z",
				updated_at: "2026-11-02T08:00:00.999Z",
			},
			{
				id: 2,
				code: null,
				kind: "archival",
				title: "Old photo",
				is_output: 0,
				origin_class: "digitalCapture",
				created_at: "2026-11-01T07:00:00.000Z",
				updated_at: "2026-11-01T07:30:00.000Z",
			},
			{
				id: 3,
				code: null,
				kind: "produced",
				title: "rec.wav",
				is_output: 0,
				origin_class: "digitalCapture",
				created_at: "2026-11-01T08:00:00.000Z",
				updated_at: "2026-11-02T08:00:00.999Z",
			},
			{
				id: 4,
				code: null,
				kind: "produced",
				title: "The cut",
				is_output: 1,
				origin_class: "compositeSynthetic",
				created_at: "2026-11-03T08:00:00.000Z",
				updated_at: "2026-11-06T11:00:00.000Z",
			},
		]);
	});

	it("records every carried value as a legacy change, at Postgres's time, with its table and id", () => {
		const { db, rootId } = setUp();
		const { runId } = migrate(db, rootId);
		const h = all(
			db,
			"SELECT at, actor_kind, actor, run_id, field, new_value, evidence FROM history WHERE table_name = 'assets' AND row_key = '4' ORDER BY id",
		);
		expect(
			h.every(
				(e) =>
					e.actor_kind === "legacy" &&
					e.actor === LEGACY_ACTOR_NAME &&
					e.run_id === runId,
			),
		).toBe(true);
		expect(h.every((e) => e.at === "2026-11-06T11:00:00.000Z")).toBe(true);
		expect(
			h.every(
				(e) =>
					e.evidence ===
					JSON.stringify({ legacy: "public.produced_assets", id: 2 }),
			),
		).toBe(true);
		expect(h.find((e) => e.field === "title")?.new_value).toBe('"The cut"');
		expect(
			h.find((e) => e.field === "origin_ingredient_classes")?.new_value,
		).toBe('["digitalCapture","trainedAlgorithmicMedia"]');
		// Nothing in the migration is said to be a person's or this tracker's choice.
		expect(
			all(
				db,
				"SELECT DISTINCT actor_kind FROM history WHERE run_id = ?",
				runId,
			),
		).toEqual([{ actor_kind: "legacy" }]);
	});

	it("keeps the project's settings, and where the catalog came from", () => {
		const { db, rootId } = setUp();
		migrate(db, rootId);
		const meta = Object.fromEntries(
			all(db, "SELECT key, value FROM meta").map((r) => [r.key, r.value]),
		);
		expect(meta).toMatchObject({
			name: "Demo film",
			description: "A made-up project",
			code_prefix: "DM",
		});
		expect(JSON.parse(meta.migrated_from as string)).toEqual({
			system: "postgres",
			project_id: 1,
			created_at: "2026-10-01T08:00:00.123Z",
			updated_at: "2026-10-02T09:00:00.500Z",
			schema_migrations: 2,
			dump_file: SOURCE.dumpFile,
			dump_sha256: SOURCE.dumpSha256,
		});
		// The name the catalog was created with is a choice made at init; Postgres's differs and is carried.
		const name = all(
			db,
			"SELECT actor_kind, new_value FROM history WHERE table_name = 'meta' AND row_key = 'name' ORDER BY id",
		);
		expect(name.at(-1)).toEqual({
			actor_kind: "legacy",
			new_value: '"Demo film"',
		});
	});

	it("places each file in its root, with the signed copy a content of its output", () => {
		const { db, rootId } = setUp();
		migrate(db, rootId);
		expect(
			all(
				db,
				"SELECT c.sha256, c.size, c.asset_id, l.root_id, l.path FROM contents c JOIN locations l ON l.content_sha256 = c.sha256 ORDER BY l.path",
			),
		).toEqual([
			{
				sha256: FILES.old.sha256,
				size: 11,
				asset_id: 2,
				root_id: rootId,
				path: "archive/old.jpg",
			},
			{
				sha256: FILES.cut.sha256,
				size: 13,
				asset_id: 4,
				root_id: rootId,
				path: "exports/cut.mp4",
			},
			{
				sha256: FILES.signed.sha256,
				size: 14,
				asset_id: 4,
				root_id: rootId,
				path: "exports/cut.signed.v1.mp4",
			},
			{
				sha256: FILES.gen.sha256,
				size: 10,
				asset_id: 1,
				root_id: rootId,
				path: "gen.png",
			},
			{
				sha256: FILES.rec.sha256,
				size: 12,
				asset_id: 3,
				root_id: rootId,
				path: "rec.wav",
			},
		]);
		expect(
			all(
				db,
				"SELECT kind, extractor, status, data FROM observations ORDER BY id",
			),
		).toEqual([
			{
				kind: "legacy-c2pa",
				extractor: "provenance-tracker app",
				status: "ok",
				data: '{"claim_generator":"Example Generator"}',
			},
			{
				kind: "legacy-exif",
				extractor: "provenance-tracker app",
				status: "ok",
				data: '{"Make":"Example"}',
			},
			{
				kind: "legacy-c2pa",
				extractor: "provenance-tracker app",
				status: "ok",
				data: '{"active_manifest":"m1"}',
			},
		]);
		// Legacy readings never stand in for a fresh ExifTool reading.
		expect(all(db, "SELECT * FROM technical")).toEqual([]);
	});

	it("keeps the signing whole and links it to the statement it used", () => {
		const { db, rootId } = setUp();
		const { runId } = migrate(db, rootId);
		const sig = one(db, "SELECT * FROM signatures");
		const statement = one(db, "SELECT * FROM statements");
		expect(statement).toMatchObject({
			asset_id: 4,
			author: "An Editor",
			organization: "Example Studio",
			edited_with: "Example Editor 1",
			saved_at: "2026-11-05T09:10:00.000Z",
		});
		expect(sig).toMatchObject({
			asset_id: 4,
			kind: "output",
			version: 1,
			source_sha256: FILES.cut.sha256,
			signed_sha256: FILES.signed.sha256,
			run_id: runId,
			engine: "c2patool",
			certificate_sha256: "",
			signer_name: "Example Signer",
			signer_issuer: "Example CA",
			timestamped: 1,
			definition: '{"title":"cut.mp4"}',
			statement_id: statement.id,
			statement: '{"text":"Made from a recording and one generated image."}',
			report: '{"validation_state":"Valid"}',
			status: "unrecognised_issuer",
			signed_at: "2026-11-06T09:00:00.250Z",
		});
	});

	it("writes the timeline for the output's file, its sources matched to the new assets", () => {
		const { db, rootId } = setUp();
		migrate(db, rootId);
		expect(
			one(
				db,
				"SELECT content_sha256, file_sha256, primary_track_index, breakdown, notes, imported_at, updated_at FROM timelines",
			),
		).toEqual({
			content_sha256: FILES.cut.sha256,
			file_sha256: FILES.timeline.sha256,
			primary_track_index: 2,
			breakdown: '{"total":10}',
			notes: '["a note"]',
			imported_at: "2026-11-04T09:00:00.000Z",
			updated_at: "2026-11-04T09:05:00.000Z",
		});
		expect(
			all(
				db,
				"SELECT source_key, kind, asset_id, match_method, match_confidence FROM timeline_sources ORDER BY id",
			),
		).toEqual([
			{
				source_key: "file-1",
				kind: "file",
				asset_id: 3,
				match_method: "hash",
				match_confidence: 1,
			},
			{
				source_key: "file-2",
				kind: "file",
				asset_id: 1,
				match_method: "path",
				match_confidence: 0.8,
			},
			{
				source_key: "gen-slug",
				kind: "generator",
				asset_id: null,
				match_method: "unmatched",
				match_confidence: 0,
			},
		]);
		expect(
			all(
				db,
				"SELECT c.clip_key, c.track_kind, c.enabled, c.in_frame, c.origin_class, s.source_key FROM timeline_clips c JOIN timeline_sources s ON s.id = c.source_id ORDER BY c.sort_order",
			),
		).toEqual([
			{
				clip_key: "clipitem-1",
				track_kind: "video",
				enabled: 1,
				in_frame: 0,
				origin_class: null,
				source_key: "file-1",
			},
			{
				clip_key: "clipitem-2",
				track_kind: "audio",
				enabled: 1,
				in_frame: 0,
				origin_class: null,
				source_key: "file-1",
			},
			{
				clip_key: "clipitem-3",
				track_kind: "video",
				enabled: 1,
				in_frame: null,
				origin_class: "algorithmicMedia",
				source_key: "file-2",
			},
			{
				clip_key: "clipitem-4",
				track_kind: "video",
				enabled: 1,
				in_frame: 0,
				origin_class: null,
				source_key: "gen-slug",
			},
		]);
	});

	it("carries a file that is not here as its content, from Postgres's hash, with no place", () => {
		const { db, rootId } = setUp();
		const result = migrate(
			db,
			rootId,
			plan(),
			factsFor(rootId, [FILES.rec.path]),
		);
		expect(result.notFound).toEqual([
			{ path: FILES.rec.path, reason: "not on this machine" },
		]);
		expect(
			one(
				db,
				"SELECT size, asset_id FROM contents WHERE sha256 = ?",
				FILES.rec.sha256,
			),
		).toEqual({ size: 12, asset_id: 3 });
		expect(
			all(
				db,
				"SELECT id FROM locations WHERE content_sha256 = ?",
				FILES.rec.sha256,
			),
		).toEqual([]);
	});
});

describe("what writeMigration refuses", () => {
	const nothingWritten = (db: DatabaseSync) => {
		expect(all(db, "SELECT id FROM assets")).toEqual([]);
		expect(all(db, "SELECT id FROM runs WHERE kind = 'migrate'")).toEqual([]);
	};

	it("a plan with blocking problems", () => {
		const { db, rootId } = setUp();
		const p = plan(
			fixtureText((rows) => {
				rows["public.timeline_segments"][1].match_method = "path";
			}),
		);
		expect(() => migrate(db, rootId, p)).toThrow(/problems to settle first/);
		nothingWritten(db);
	});

	it("a file that holds other bytes than Postgres recorded", () => {
		const { db, rootId } = setUp();
		const facts = factsFor(rootId, [], { [FILES.cut.path]: "7".repeat(64) });
		expect(fileProblems(plan(), facts)).toEqual([
			"produced:2: P:/media/exports/cut.mp4 holds other bytes than Postgres recorded (777777777777…, Postgres dddddddddddd…)",
			"signature 8 source: P:/media/exports/cut.mp4 holds other bytes than Postgres recorded (777777777777…, Postgres dddddddddddd…)",
		]);
		expect(() => migrate(db, rootId, plan(), facts)).toThrow(
			/Files to settle first/,
		);
		nothingWritten(db);
	});

	it("a missing file with no hash to carry, and a missing signed source that is not the asset's file", () => {
		const { db, rootId } = setUp();
		const p = plan(
			fixtureText((rows) => {
				rows["public.produced_assets"][0].file_hash = "";
				rows["public.signatures"][0].source_hash = "8".repeat(64);
			}),
		);
		const facts = factsFor(rootId, [FILES.rec.path, FILES.cut.path]);
		expect(fileProblems(p, facts)).toEqual([
			"produced:1: P:/media/rec.wav is not there (not on this machine), and Postgres has no hash and size to carry",
			"signature 8 source: P:/media/exports/cut.mp4 is not there, and the bytes Postgres recorded as signed (888888888888…) are not the asset's file",
		]);
		expect(() => migrate(db, rootId, p, facts)).toThrow(
			/Files to settle first/,
		);
		nothingWritten(db);
	});

	it("a timeline whose file is not in the project's timelines folder", () => {
		const { db, rootId } = setUp();
		expect(() =>
			writeMigration(db, plan(), {
				facts: factsFor(rootId),
				timelineFiles: () => false,
				source: SOURCE,
				tool: TEST_TOOL,
			}),
		).toThrow(
			/timeline 4: its file 111111111111… is not in the project's timelines folder/,
		);
		nothingWritten(db);
	});

	it("a catalog that already has assets", () => {
		const { db, rootId } = setUp();
		createRow(db, "assets", { kind: "archival" }, PERSON);
		expect(() => migrate(db, rootId)).toThrow(/new catalog with no assets/);
	});

	it("two assets with the same bytes, rolling everything back and recording the run as failed", () => {
		const { db, rootId } = setUp();
		const facts = factsFor(rootId);
		const sameAsGen = (p: string): FileFact => {
			const f = facts(p);
			return f.found && p === FILES.old.path
				? { ...f, sha256: FILES.gen.sha256 }
				: f;
		};
		const p = plan(
			fixtureText((rows) => {
				rows["public.archival_assets"][0].file_hash = FILES.gen.sha256;
			}),
		);
		expect(() => migrate(db, rootId, p, sameAsGen)).toThrow(
			/same bytes as another asset's file/,
		);
		expect(all(db, "SELECT id FROM assets")).toEqual([]);
		expect(all(db, "SELECT outcome FROM runs WHERE kind = 'migrate'")).toEqual([
			{ outcome: "failed" },
		]);
	});
});
