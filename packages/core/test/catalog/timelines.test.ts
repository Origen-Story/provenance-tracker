import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createRow, type Actor } from "../../src/catalog/edit.ts";
import { editAsset } from "../../src/catalog/edits.ts";
import { EditError, NotFoundError } from "../../src/catalog/errors.ts";
import { finishRun, startRun } from "../../src/catalog/runs.ts";
import {
	matchableFiles,
	removeTimeline,
	saveStatement,
	setClipClass,
	setSourceMatch,
	setTimelineSettings,
	timelineRecord,
	timelinesUsing,
	writeTimeline,
	type NewTimeline,
	type TimelineSegment,
} from "../../src/catalog/timelines.ts";
import { PERSON, TEST_TOOL, sha } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";

const { catalog } = catalogsForTests();
const AT = "2026-11-23T12:00:00.000Z";
const ME = { actor: PERSON.actor as Actor, tool: TEST_TOOL, now: AT };

/** A project with a recording (captured), a generated clip (AI), and an output with its cut. */
function world() {
	const db = catalog();
	const root = Number(
		createRow(
			db,
			"roots",
			{ name: "media", folder_in_project: "media" },
			PERSON,
		),
	);
	const run = startRun(db, { kind: "scan", tool: TEST_TOOL, now: AT });
	const tool: Actor = { kind: "tool", name: "t", runId: run };
	const asset = (values: Record<string, unknown>, c: string, path: string) => {
		const id = Number(
			createRow(db, "assets", values, { actor: tool, now: AT }),
		);
		createRow(
			db,
			"contents",
			{ sha256: sha(c), size: 100, asset_id: id, first_run_id: run },
			{ actor: tool, now: AT },
		);
		db.prepare(
			"INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id) VALUES (?, ?, ?, 0, ?, ?)",
		).run(sha(c), root, path, run, run);
		return id;
	};
	const rec = asset(
		{ kind: "produced", origin_class: "digitalCapture" },
		"a",
		"rec.wav",
	);
	const gen = asset(
		{ kind: "generated", origin_class: "trainedAlgorithmicMedia" },
		"b",
		"gen.mp4",
	);
	const film = asset({ kind: "produced" }, "c", "exports/film.mp4");
	finishRun(db, run, { outcome: "ok", now: AT });
	return { db, rec, gen, film };
}

const seg = (over: Partial<TimelineSegment>): TimelineSegment => ({
	clipId: "c",
	name: "",
	trackKind: "video",
	trackIndex: 1,
	enabled: true,
	startFrame: 0,
	endFrame: 10,
	inFrame: 0,
	outFrame: 10,
	sourceKind: "file",
	sourceKey: null,
	sourceName: "",
	sourcePath: "",
	matchedAssetRef: null,
	matchMethod: "unmatched",
	matchConfidence: 0,
	...over,
});

function timeline(
	w: ReturnType<typeof world>,
	segments?: TimelineSegment[],
): NewTimeline {
	return {
		outputAssetId: w.film,
		contentSha256: sha("c"),
		format: "xmeml",
		formatVersion: "4",
		fileName: "cut.xml",
		fileSha256: sha("9"),
		sequence: {
			name: "Cut",
			timebase: 25,
			ntsc: false,
			fps: 25,
			durationFrames: 100,
			width: 1920,
			height: 1080,
		},
		notes: [],
		segments: segments ?? [
			seg({
				clipId: "c1",
				name: "rec.wav",
				startFrame: 0,
				endFrame: 50,
				sourceKey: "file-1",
				sourceName: "rec.wav",
				matchedAssetRef: String(w.rec),
				matchMethod: "path",
				matchConfidence: 1,
			}),
			seg({
				clipId: "c2",
				name: "rec.wav",
				trackKind: "audio",
				startFrame: 0,
				endFrame: 50,
				sourceKey: "file-1",
				sourceName: "rec.wav",
				matchedAssetRef: String(w.rec),
				matchMethod: "path",
				matchConfidence: 1,
			}),
			seg({
				clipId: "c3",
				name: "title",
				startFrame: 50,
				endFrame: 100,
				sourceKind: "generator",
				sourceName: "Title",
			}),
		],
	};
}

const asset = (db: DatabaseSync, id: number) =>
	db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Record<
		string,
		unknown
	>;

describe("writeTimeline", () => {
	it("writes the timeline, a source per file with its match, every clip, and its breakdown", () => {
		const w = world();
		const { timelineId, runId } = writeTimeline(w.db, timeline(w), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		const t = timelineRecord(w.db, timelineId)!;
		expect(t).toMatchObject({
			outputAssetId: w.film,
			contentSha256: sha("c"),
			fileName: "cut.xml",
			fps: 25,
			primaryTrackIndex: 1,
		});
		expect(
			t.sources.map((s) => [s.key, s.kind, s.assetId, s.matchMethod, s.clips]),
		).toEqual([
			["file-1", "file", w.rec, "path", 2],
			["generator:Title", "generator", null, "unmatched", 1],
		]);
		expect(
			t.clips.map((c) => [c.clipKey, c.trackKind, c.startFrame, c.endFrame]),
		).toEqual([
			["c1", "video", 0, 50],
			["c2", "audio", 0, 50],
			["c3", "video", 50, 100],
		]);
		// The breakdown names assets by their catalog ids (D23).
		const b = t.breakdown as {
			primary: { byClass: Record<string, { frames: number }> };
			composition: {
				picture: {
					intervals: Array<{
						layers: Array<{ matchedAssetRef: string | null }>;
					}>;
				};
			};
		};
		expect(b.primary.byClass).toMatchObject({
			digitalCapture: { frames: 50 },
			digitalCreation: { frames: 50 },
		});
		expect(b.composition.picture.intervals[0].layers[0].matchedAssetRef).toBe(
			String(w.rec),
		);
		expect(
			w.db.prepare("SELECT kind, outcome FROM runs WHERE id = ?").get(runId),
		).toEqual({ kind: "timeline", outcome: "ok" });
	});

	it("links what it used to the output, marks the output a finished edit, and classes it from what is on screen", () => {
		const w = world();
		writeTimeline(w.db, timeline(w), { tool: TEST_TOOL, now: () => AT });
		expect(
			w.db
				.prepare(
					"SELECT parent_id, child_id, type, match_method FROM relationships",
				)
				.all(),
		).toEqual([
			{
				parent_id: w.rec,
				child_id: w.film,
				type: "output_of",
				match_method: "timeline",
			},
		]);
		expect(asset(w.db, w.film)).toMatchObject({
			is_output: 1,
			output_source: "timeline",
			origin_class: "composite",
			origin_class_source: "timeline_composition",
		});
		expect(timelinesUsing(w.db, w.rec)).toHaveLength(1);
	});

	it("refuses a cut that is not the output's own file, writing nothing", () => {
		const w = world();
		expect(() =>
			writeTimeline(
				w.db,
				{ ...timeline(w), contentSha256: sha("a") },
				{ tool: TEST_TOOL },
			),
		).toThrow(EditError);
		expect(w.db.prepare("SELECT count(*) AS n FROM timelines").get()).toEqual({
			n: 0,
		});
	});
});

describe("what changes what is on screen", () => {
	it("an asset's new class refreshes its timelines and the output's class follows, unless a person set it", () => {
		const w = world();
		const { timelineId } = writeTimeline(w.db, timeline(w), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		editAsset(w.db, w.rec, { origin_class: "trainedAlgorithmicMedia" }, ME);
		const b = timelineRecord(w.db, timelineId)!.breakdown as {
			primary: { byClass: Record<string, unknown> };
		};
		expect(Object.keys(b.primary.byClass).sort()).toEqual([
			"digitalCreation",
			"trainedAlgorithmicMedia",
		]);
		expect(asset(w.db, w.film).origin_class).toBe("compositeSynthetic");

		editAsset(w.db, w.film, { origin_class: "composite" }, ME);
		editAsset(w.db, w.rec, { origin_class: "digitalCapture" }, ME);
		expect(asset(w.db, w.film)).toMatchObject({
			origin_class: "composite",
			origin_class_source: "user",
		});
	});

	it("a source's new match, a clip's own class and the timeline's settings each refresh it", () => {
		const w = world();
		const { timelineId } = writeTimeline(w.db, timeline(w), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		const t = timelineRecord(w.db, timelineId)!;
		const title = t.sources[1];
		setSourceMatch(
			w.db,
			timelineId,
			title.id,
			{ assetId: w.gen, method: "manual" },
			ME,
		);
		let after = timelineRecord(w.db, timelineId)!;
		expect(after.sources[1]).toMatchObject({
			assetId: w.gen,
			matchMethod: "manual",
			matchConfidence: 1,
		});
		expect(asset(w.db, w.film).origin_class).toBe("compositeSynthetic");
		expect(
			w.db
				.prepare(
					"SELECT count(*) AS n FROM relationships WHERE parent_id = ? AND child_id = ?",
				)
				.get(w.gen, w.film),
		).toEqual({ n: 1 });

		setClipClass(w.db, timelineId, after.clips[2].id, "digitalCreation", ME);
		after = timelineRecord(w.db, timelineId)!;
		expect(after.clips[2].originClass).toBe("digitalCreation");
		expect(asset(w.db, w.film).origin_class).toBe("composite");

		expect(
			setTimelineSettings(w.db, timelineId, { primary_track_index: 2 }, ME),
		).toEqual(["primary_track_index"]);
		expect(
			(
				timelineRecord(w.db, timelineId)!.breakdown as {
					primary: { trackIndex: number };
				}
			).primary.trackIndex,
		).toBe(2);
		expect(() =>
			setSourceMatch(
				w.db,
				timelineId,
				999,
				{ assetId: null, method: "unmatched" },
				ME,
			),
		).toThrow(NotFoundError);
	});

	it("carries the classes a person gave clips to the next import of the edit, by what the clip is, not its id", () => {
		const w = world();
		// A subclip with no asset of its own, on picture and sound, and a recording used twice.
		const cut = (ids: string[]) => [
			seg({
				clipId: ids[0],
				name: "plate-subclip",
				trackIndex: 4,
				sourceKind: "sequence",
				sourceName: "plate-subclip",
			}),
			seg({
				clipId: ids[1],
				name: "plate-subclip",
				trackKind: "audio",
				sourceKind: "sequence",
				sourceName: "plate-subclip",
			}),
			seg({
				clipId: ids[2],
				name: "rec.wav",
				sourceKey: "file-1",
				sourceName: "rec.wav",
				matchedAssetRef: String(w.rec),
				matchMethod: "path",
				matchConfidence: 1,
			}),
			seg({
				clipId: ids[3],
				name: "rec.wav",
				startFrame: 50,
				endFrame: 60,
				sourceKey: "file-1",
				sourceName: "rec.wav",
				matchedAssetRef: String(w.rec),
				matchMethod: "path",
				matchConfidence: 1,
			}),
		];
		const first = writeTimeline(w.db, timeline(w, cut(["a", "b", "c", "d"])), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		expect(first.carriedClasses).toBe(0);
		const clips = timelineRecord(w.db, first.timelineId)!.clips;
		setClipClass(w.db, first.timelineId, clips[0].id, "compositeSynthetic", ME);
		setClipClass(w.db, first.timelineId, clips[1].id, "compositeSynthetic", ME);
		// The same recording given two classes says nothing about the next cut's use of it.
		setClipClass(w.db, first.timelineId, clips[2].id, "digitalCreation", ME);
		setClipClass(w.db, first.timelineId, clips[3].id, "composite", ME);

		// A re-export: the editor numbers the clips afresh.
		const second = writeTimeline(w.db, timeline(w, cut(["w", "x", "y", "z"])), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		expect(second.carriedClasses).toBe(2);
		const now = timelineRecord(w.db, second.timelineId)!;
		expect(now.clips.map((c) => c.originClass)).toEqual([
			"compositeSynthetic",
			"compositeSynthetic",
			null,
			null,
		]);
		const h = w.db
			.prepare(
				"SELECT actor_kind, new_value, evidence FROM history WHERE table_name = 'timeline_clips' AND row_key = ? AND field = 'origin_class'",
			)
			.get(String(now.clips[0].id)) as {
			actor_kind: string;
			new_value: string;
			evidence: string;
		};
		expect(h.actor_kind).toBe("tool");
		expect(JSON.parse(h.evidence)).toMatchObject({
			carried_from_timeline: first.timelineId,
		});

		// Cleared in the newest timeline: not brought back from an older one.
		setClipClass(w.db, second.timelineId, now.clips[0].id, null, ME);
		const third = writeTimeline(w.db, timeline(w, cut(["p", "q", "r", "s"])), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		expect(third.carriedClasses).toBe(1);
		expect(
			timelineRecord(w.db, third.timelineId)!.clips.map((c) => c.originClass),
		).toEqual([null, "compositeSynthetic", null, null]);
	});

	it("removes a timeline with its sources and clips, keeping their last values in history", () => {
		const w = world();
		const { timelineId } = writeTimeline(w.db, timeline(w), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		removeTimeline(w.db, timelineId, ME);
		expect(
			w.db.prepare("SELECT count(*) AS n FROM timeline_clips").get(),
		).toEqual({ n: 0 });
		expect(timelinesUsing(w.db, w.rec)).toEqual([]);
		expect(() => removeTimeline(w.db, timelineId, ME)).toThrow(NotFoundError);
	});
});

describe("saveStatement", () => {
	it("saves each version of an output's statement as a new row, and refuses one for anything else", () => {
		const w = world();
		writeTimeline(w.db, timeline(w), { tool: TEST_TOOL, now: () => AT });
		const a = saveStatement(
			w.db,
			w.film,
			{ text: "  Made from a recording. ", author: "A. Maker" },
			{ now: AT },
		);
		const b = saveStatement(
			w.db,
			w.film,
			{
				text: "Made from a recording and a title.",
				author: "A. Maker",
				editedWith: "Example Editor",
			},
			{ now: AT },
		);
		expect(
			w.db
				.prepare("SELECT id, text, edited_with FROM statements ORDER BY id")
				.all(),
		).toEqual([
			{ id: a, text: "Made from a recording.", edited_with: "" },
			{
				id: b,
				text: "Made from a recording and a title.",
				edited_with: "Example Editor",
			},
		]);
		expect(() => saveStatement(w.db, w.rec, { text: "x" }, {})).toThrow(
			/finished edit/,
		);
		expect(() => saveStatement(w.db, w.film, { text: "  " }, {})).toThrow(
			/needs its words/,
		);
		expect(() => saveStatement(w.db, 999, { text: "x" }, {})).toThrow(
			NotFoundError,
		);
	});
});

describe("matchableFiles", () => {
	it("lists each asset's files with their live places", () => {
		const w = world();
		expect(matchableFiles(w.db).map((f) => [f.assetId, f.path])).toEqual([
			[w.rec, "rec.wav"],
			[w.gen, "gen.mp4"],
			[w.film, "exports/film.mp4"],
		]);
	});
});
