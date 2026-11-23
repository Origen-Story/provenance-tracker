import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeObservation } from "@provenancetracker/core/extraction/observation.ts";
import { LEGACY_TABLES } from "@provenancetracker/core/legacy/tables.ts";
import { computeBreakdown } from "@provenancetracker/core/timeline/breakdown.js";
import type { Reader } from "../src/extract.ts";
import {
	dryRun,
	readLayout,
	type MigrationLayout,
} from "../src/legacy/migrate.ts";
import { machinesForTests } from "./helpers/machine.ts";

const { tempDir, machine } = machinesForTests();
const ME = { kind: "person" as const, name: "Test Person" };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

type Row = Record<string, string | number | boolean | null>;

/** Dump text with every known table and column; unset values null, times set. */
function dumpText(rows: Record<string, Row[]>): string {
	const field = (v: Row[string] | undefined) =>
		v === null || v === undefined
			? "\\N"
			: typeof v === "boolean"
				? v
					? "t"
					: "f"
				: String(v)
						.replaceAll("\\", "\\\\")
						.replaceAll("\t", "\\t")
						.replaceAll("\n", "\\n");
	const out = ["SET client_encoding = 'UTF8';"];
	for (const [table, rule] of Object.entries(LEGACY_TABLES)) {
		const columns = Object.keys(rule.columns);
		out.push(`COPY ${table} (${columns.join(", ")}) FROM stdin;`);
		for (const row of rows[table] ?? []) {
			const full: Row = {
				created_at: "2026-11-01 10:00:00+01",
				updated_at: "2026-11-02 10:00:00+01",
				...row,
			};
			out.push(columns.map((c) => field(full[c])).join("\t"));
		}
		out.push("\\.");
	}
	return `${out.join("\n")}\n`;
}

const STATEMENT = JSON.stringify({
	version: 2,
	text: "A cut.",
	output: { title: "cut.mp4", originClass: "compositeSynthetic" },
	composition: { picture: { intervals: [] }, audio: { intervals: [] } },
	ingredients: [],
});

/** A project folder with an inside root, an outside root, a timeline file and a dump. */
function world(opts: { strayFile?: boolean } = {}) {
	const top = tempDir();
	const folder = path.join(top, "demo");
	const footage = path.join(folder, "footage");
	const archive = path.join(top, "archive");
	const dumps = path.join(top, "dumps");
	const app = path.join(top, "app");
	for (const d of [footage, archive, dumps, app])
		mkdirSync(d, { recursive: true });
	const files = {
		rec: [path.join(footage, "rec.wav"), "recording bytes"],
		cut: [path.join(footage, "cut.mp4"), "cut bytes"],
		signed: [path.join(footage, "cut.signed.v1.mp4"), "signed bytes"],
		old: [path.join(archive, "old.jpg"), "old photo bytes"],
		timeline: [path.join(app, "cut.xml"), "<xmeml/>"],
		stray: [path.join(top, "stray.wav"), "outside every root"],
	} as const;
	for (const [p, text] of Object.values(files)) writeFileSync(p, text);
	writeFileSync(path.join(footage, "extra.txt"), "a file Postgres never had");
	const f = (k: keyof typeof files) => ({
		path: files[k][0],
		hash: sha(files[k][1]),
		size: Buffer.byteLength(files[k][1]),
	});

	const segments = [
		{
			id: 10,
			clipId: "c1",
			name: "rec.wav",
			trackKind: "video",
			trackIndex: 1,
			enabled: true,
			startFrame: 0,
			endFrame: 50,
			inFrame: 0,
			outFrame: 50,
			sourceKind: "file",
			sourceKey: "file-1",
			sourceName: "rec.wav",
			matchedAssetRef: "produced:1",
			matched: true,
			originClass: "digitalCapture",
			aiAssisted: false,
		},
		{
			id: 11,
			clipId: "c2",
			name: "",
			trackKind: "video",
			trackIndex: 1,
			enabled: true,
			startFrame: 50,
			endFrame: 100,
			inFrame: 0,
			outFrame: 0,
			sourceKind: "generator",
			sourceKey: "gen",
			sourceName: "",
			matchedAssetRef: null,
			matched: false,
			originClass: null,
			aiAssisted: false,
		},
	];
	const breakdown = JSON.stringify(
		computeBreakdown(segments, {
			durationFrames: 100,
			fps: 25,
			primaryTrackIndex: 1,
			includeOverlays: false,
		}),
	);
	const rec = opts.strayFile ? f("stray") : f("rec");

	const text = dumpText({
		"public.projects": [
			{ id: 1, name: "demo", asset_id_prefix: "DM" },
			{ id: 2, name: "other" },
		],
		"public.archival_assets": [
			{
				id: 1,
				project_id: 1,
				name: "Old photo",
				filename: "old.jpg",
				file_path: f("old").path,
				file_hash: f("old").hash,
				file_size: f("old").size,
				origin_class: "digitalCapture",
				origin_ingredient_classes: "[]",
				exif_json: "{}",
			},
		],
		"public.produced_assets": [
			{
				id: 1,
				project_id: 1,
				name: "rec.wav",
				filename: path.basename(rec.path),
				file_path: rec.path,
				file_hash: rec.hash,
				file_size: rec.size,
				origin_class: "digitalCapture",
				origin_ingredient_classes: "[]",
				exif_json: "{}",
				duration_seconds: 2.5,
			},
			{
				id: 2,
				project_id: 1,
				name: "The cut",
				filename: "cut.mp4",
				file_path: f("cut").path,
				file_hash: f("cut").hash,
				file_size: f("cut").size,
				origin_class: "compositeSynthetic",
				origin_ingredient_classes: "[]",
				exif_json: "{}",
				is_output: true,
				output_source: "timeline",
				width: 1920,
			},
		],
		"public.asset_relationships": [
			{
				id: 1,
				parent_asset_type: "produced",
				parent_asset_id: 1,
				child_asset_type: "produced",
				child_asset_id: 2,
				relationship_type: "output_of",
				match_method: "timeline",
				confidence: 1,
				notes: "",
			},
		],
		"public.timelines": [
			{
				id: 4,
				project_id: 1,
				produced_asset_id: 2,
				source_format: "xmeml",
				source_file_name: "cut.xml",
				source_file_path: f("timeline").path,
				source_file_hash: f("timeline").hash,
				timebase: 25,
				ntsc: false,
				fps: 25,
				duration_frames: 100,
				primary_track_index: 1,
				include_overlays: false,
				breakdown_json: breakdown,
				notes_json: "[]",
			},
		],
		"public.timeline_segments": [
			{
				id: 10,
				timeline_id: 4,
				track_kind: "video",
				track_index: 1,
				clip_id: "c1",
				clip_name: "rec.wav",
				enabled: true,
				start_frame: 0,
				end_frame: 50,
				in_frame: 0,
				out_frame: 50,
				source_kind: "file",
				source_key: "file-1",
				source_name: "rec.wav",
				source_path: "",
				matched_asset_type: "produced",
				matched_asset_id: 1,
				match_method: "hash",
				match_confidence: 1,
				sort_order: 0,
			},
			{
				id: 11,
				timeline_id: 4,
				track_kind: "video",
				track_index: 1,
				clip_id: "c2",
				clip_name: "",
				enabled: true,
				start_frame: 50,
				end_frame: 100,
				in_frame: 0,
				out_frame: 0,
				source_kind: "generator",
				source_key: "gen",
				source_name: "",
				source_path: "",
				match_method: "unmatched",
				match_confidence: 0,
				sort_order: 1,
			},
		],
		"public.creator_statements": [
			{
				id: 5,
				project_id: 1,
				produced_asset_id: 2,
				text: "A cut.",
				author_name: "An Editor",
				updated_at: "2026-11-05 10:00:00+01",
			},
		],
		"public.signatures": [
			{
				id: 8,
				project_id: 1,
				asset_type: "produced",
				asset_id: 2,
				kind: "output",
				version: 1,
				source_path: f("cut").path,
				source_hash: f("cut").hash,
				signed_path: f("signed").path,
				signed_hash: f("signed").hash,
				signed_size: f("signed").size,
				definition_json: "{}",
				report_json: "{}",
				statement_json: STATEMENT,
				status: "",
				timestamped: false,
				created_at: "2026-11-06 10:00:00.123456+01",
			},
		],
	});
	const dump = path.join(dumps, "provenance-tracker_2026-11-21_223001.dump");
	writeFileSync(dump, "a binary dump");
	writeFileSync(
		`${dump}.sha256`,
		`${sha("a binary dump")}  ${path.basename(dump)}\n`,
	);
	const layout: MigrationLayout = {
		dumps,
		projects: [{ legacy: "demo", folder, roots: { footage, archive } }],
	};
	return {
		top,
		folder,
		dumps,
		dump,
		layout,
		restore: async (_d: string, out: string) => writeFileSync(out, text),
	};
}

/** A stand-in ExifTool: a WAV of 2.5 s, and an MP4 with no size in pixels. */
const fakeExif: Reader = {
	kind: "exif",
	extractor: "exiftool",
	version: "13.0",
	read: async (f) =>
		makeObservation({
			kind: "exif",
			extractor: "exiftool",
			version: "13.0",
			status: "ok",
			data: f.endsWith(".wav")
				? { MIMEType: "audio/wav", Duration: 2.5 }
				: { MIMEType: "video/mp4" },
		}),
};

const pending = () =>
	readdirSync(tmpdir()).filter((n) => n.startsWith("pt-migrate-dry-run-"))
		.length;

describe("the migration's dry run", () => {
	it("builds the catalog in a throwaway folder, checks it all, and keeps nothing", async () => {
		const w = world();
		const m = machine();
		const before = pending();
		const report = await dryRun({
			layout: w.layout,
			machine: m,
			actor: ME,
			exifReader: fakeExif,
			restore: w.restore,
		});

		expect(report.dump).toEqual({
			file: "provenance-tracker_2026-11-21_223001.dump",
			sha256: sha("a binary dump"),
		});
		expect(report.orphans).toEqual([]);
		expect(report.notInLayout).toEqual([{ id: 2, name: "other" }]);
		const [p] = report.projects;
		expect(p.error).toBeNull();
		expect(p.problems).toEqual([]);
		expect(p.roots.map((r) => [r.name, r.inProject, r.status])).toEqual([
			["footage", true, "ok"],
			["archive", false, "ok"],
		]);
		expect(p.files.map((f) => [f.root, f.catalogPath])).toEqual([
			["archive", "old.jpg"],
			["footage", "rec.wav"],
			["footage", "cut.mp4"],
			["footage", "cut.signed.v1.mp4"],
		]);
		expect(p.written).toEqual({
			assets: 3,
			contents: 4,
			locations: 4,
			relationships: 1,
			statements: 1,
			signatures: 1,
			timelines: 1,
			timeline_sources: 2,
			timeline_clips: 2,
		});
		expect(p.verify).toEqual([]);
		expect(p.breakdowns).toEqual([
			{ timeline: 4, same: true, differences: [], oldShape: false },
		]);
		expect(p.exports).toEqual([{ signature: 8, same: true, differences: [] }]);
		// A difference in technical values is reported, and does not stop the run.
		expect(p.technical).toEqual({
			compared: 2,
			differences: ["produced:2 width: Postgres 1920, ExifTool now nothing"],
		});
		expect(p.scan).toEqual({
			unchanged: 4,
			added: 1,
			gone: 0,
			addedFiles: ["footage/extra.txt"],
		});
		expect(p.ok).toBe(true);
		expect(report.ok).toBe(true);

		// Nothing kept: no catalog in the project folder, no settings, no temp folder.
		expect(existsSync(path.join(w.folder, ".provenancetracker"))).toBe(false);
		expect(existsSync(m.settingsPath)).toBe(false);
		expect(pending()).toBe(before);
	});

	it("stops before writing when a file Postgres names is outside every root", async () => {
		const w = world({ strayFile: true });
		const report = await dryRun({
			layout: w.layout,
			machine: machine(),
			actor: ME,
			exifReader: null,
			restore: w.restore,
		});
		const [p] = report.projects;
		expect(p.problems).toEqual([
			`${path.join(w.top, "stray.wav")} is outside every root of the layout`,
		]);
		expect(p.written).toBeNull();
		expect(p.ok).toBe(false);
		expect(report.ok).toBe(false);
	});

	it("refuses a dump that does not match its .sha256", async () => {
		const w = world();
		writeFileSync(w.dump, "other bytes");
		await expect(
			dryRun({
				layout: w.layout,
				machine: machine(),
				actor: ME,
				restore: w.restore,
			}),
		).rejects.toThrow(/does not match its \.sha256/);
	});

	it("refuses a layout naming a project the dump does not have", async () => {
		const w = world();
		const layout = {
			...w.layout,
			projects: [{ ...w.layout.projects[0], legacy: "nope" }],
		};
		await expect(
			dryRun({ layout, machine: machine(), actor: ME, restore: w.restore }),
		).rejects.toThrow(
			/names "nope", which the dump does not have \(it has: demo, other\)/,
		);
	});
});

describe("readLayout", () => {
	it("reads a layout with full paths", () => {
		const dir = tempDir();
		const file = path.join(dir, "layout.json");
		const layout = {
			dumps: dir,
			projects: [
				{
					legacy: "demo",
					folder: path.join(dir, "demo"),
					roots: { a: path.join(dir, "a") },
				},
			],
		};
		writeFileSync(file, JSON.stringify(layout));
		expect(readLayout(file)).toEqual(layout);
	});

	it("says everything wrong with one that is not usable", () => {
		const dir = tempDir();
		const file = path.join(dir, "layout.json");
		writeFileSync(
			file,
			JSON.stringify({
				dumps: "relative",
				projects: [
					{ legacy: "a", folder: dir, roots: {} },
					{ legacy: "a", folder: dir, roots: { x: "y" } },
				],
			}),
		);
		expect(() => readLayout(file)).toThrow(
			/dumps must be a full path\n- projects\[0\]\.roots must name at least one root and its folder\n- projects\[1\]: a is listed twice\n- projects\[1\]\.roots\.x must be a full path/,
		);
		writeFileSync(file, "{ not json");
		expect(() => readLayout(file)).toThrow(/is not readable JSON/);
	});
});
