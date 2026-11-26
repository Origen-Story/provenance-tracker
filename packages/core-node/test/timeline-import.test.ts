// Importing a timeline: which of the paths it names are opened (D65). A
// timeline is a file from somewhere else, so a path in it is opened only
// inside the project's media folders. The paths here are in each test's own
// temporary folder; network forms are tried as strings against a stand-in
// reader, never against the disk.

import { describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createProject, openProject } from "../src/project.ts";
import { addRoot } from "../src/roots.ts";
import { scanProject } from "../src/scan.ts";
import {
	importTimeline,
	matchEvidence,
	sourceReader,
	type SourceFiles,
} from "../src/timeline-import.ts";
import { machinesForTests } from "./helpers/machine.ts";

const { machine, folder, track } = machinesForTests();
const ME = { kind: "person" as const, name: "Test Person" };

/** A timeline file's address for a path on this machine, as an editor writes one. */
const pathurl = (file: string) =>
	`file://localhost/${encodeURI(file.replace(/\\/g, "/").replace(/^\//, ""))}`;

/** A one-track timeline placing each named file for a second. */
const timelineOf = (sources: Array<{ name: string; url: string }>) =>
	Buffer.from(
		`<?xml version="1.0"?><xmeml version="4"><sequence id="s1"><name>Cut</name><duration>${sources.length * 25}</duration><rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate><media><video><track>${sources
			.map(
				(s, i) =>
					`<clipitem id="c${i}"><name>${s.name}</name><enabled>TRUE</enabled><start>${i * 25}</start><end>${(i + 1) * 25}</end><in>0</in><out>25</out><file id="f${i}"><name>${s.name}</name><pathurl>${s.url}</pathurl></file></clipitem>`,
			)
			.join("")}</track></video></media></sequence></xmeml>`,
	);

/** A project with a film and one clip in its media folder, and a folder beside it that is not the project's. */
async function world() {
	const m = machine();
	const dir = folder("tl");
	const media = path.join(dir, "Demo", "media");
	const elsewhere = path.join(dir, "elsewhere");
	mkdirSync(media, { recursive: true });
	mkdirSync(elsewhere);
	writeFileSync(path.join(media, "film.mp4"), "the cut");
	writeFileSync(path.join(media, "clip.mov"), "clip one");
	createProject(path.join(dir, "Demo"), { name: "Demo", machine: m });
	const p = track(openProject(path.join(dir, "Demo"), { machine: m }));
	addRoot(p, m, { name: "media", folder: media, actor: ME });
	await scanProject(p, m);
	const id = (name: string) =>
		(
			p.db
				.prepare(
					"SELECT c.asset_id AS id FROM contents c JOIN locations l ON l.content_sha256 = c.sha256 WHERE l.path = ?",
				)
				.get(name) as { id: number }
		).id;
	const sources = (timelineId: number) =>
		p.db
			.prepare(
				"SELECT name, asset_id AS assetId, match_method AS method FROM timeline_sources WHERE timeline_id = ? ORDER BY id",
			)
			.all(timelineId);
	return { m, p, media, elsewhere, id, sources };
}

describe("sourceReader (D65)", () => {
	const seen: string[] = [];
	const files: SourceFiles = {
		exists: (f) => (seen.push(`exists ${f}`), true),
		size: (f) => (seen.push(`size ${f}`), 7),
		hash: async (f) => (seen.push(`hash ${f}`), "h"),
	};
	const reader = sourceReader(["P:\\Demo\\media"], "win32", files);

	it("opens a path inside a media folder", async () => {
		seen.length = 0;
		expect(await reader.statSize("P:\\Demo\\media\\clip.mov")).toBe(7);
		expect(await reader.hashFile("P:/Demo/media/clip.mov")).toBe("h");
		expect(seen).toEqual([
			"exists P:\\Demo\\media\\clip.mov",
			"size P:\\Demo\\media\\clip.mov",
			"exists P:/Demo/media/clip.mov",
			"hash P:/Demo/media/clip.mov",
		]);
	});

	it("answers as if nothing were there for any other path, without asking the disk", async () => {
		seen.length = 0;
		for (const p of [
			"\\\\host\\share\\clip.mov",
			"//host/share/clip.mov",
			"\\\\?\\P:\\Demo\\media\\clip.mov",
			"\\\\.\\PhysicalDrive0",
			"C:\\Users\\someone\\secret.txt",
			"P:\\Demo\\media\\..\\catalog.sqlite",
			"clip.mov",
			"",
		]) {
			expect(await reader.statSize(p), p).toBeNull();
			expect(await reader.hashFile(p), p).toBeNull();
		}
		expect(seen).toEqual([]);
	});
});

describe("importTimeline and the paths a timeline names (D65)", () => {
	it("matches by bytes only a file inside the project's media folders", async () => {
		const w = await world();
		// The clip's bytes under another name, in two places the catalog has
		// not seen: beside the project, and inside its media folder.
		const outside = path.join(w.elsewhere, "renamed.mov");
		const inside = path.join(w.media, "also renamed.mov");
		copyFileSync(path.join(w.media, "clip.mov"), outside);
		copyFileSync(path.join(w.media, "clip.mov"), inside);
		const r = await importTimeline(w.p, w.m, {
			outputAssetId: w.id("film.mp4"),
			fileName: "cut.xml",
			bytes: timelineOf([
				{ name: "renamed.mov", url: pathurl(outside) },
				{ name: "also renamed.mov", url: pathurl(inside) },
				{ name: "clip.mov", url: pathurl(path.join(w.elsewhere, "clip.mov")) },
			]),
		});
		expect(w.sources(r.timelineId)).toEqual([
			// Outside: not opened, so not known to be the clip.
			{ name: "renamed.mov", assetId: null, method: "unmatched" },
			// Inside: read, and its bytes are the clip's.
			{ name: "also renamed.mov", assetId: w.id("clip.mov"), method: "hash" },
			// Named like the clip, at a path that is not the project's: by name.
			{ name: "clip.mov", assetId: w.id("clip.mov"), method: "filename" },
		]);
	});

	it("takes a person's pick for a source outside the media folders as their word, without reading the file", async () => {
		const w = await world();
		const outside = path.join(w.elsewhere, "renamed.mov");
		copyFileSync(path.join(w.media, "clip.mov"), outside);
		// The same bytes: reading it would have called this "hash".
		expect(await matchEvidence(w.p, w.m, outside, w.id("clip.mov"))).toBe(
			"manual",
		);
		// The catalog's own path for the asset is still stronger than a pick.
		expect(
			await matchEvidence(
				w.p,
				w.m,
				path.join(w.media, "clip.mov"),
				w.id("clip.mov"),
			),
		).toBe("path");
		// And a copy inside the media folder is read.
		const inside = path.join(w.media, "also renamed.mov");
		copyFileSync(path.join(w.media, "clip.mov"), inside);
		expect(await matchEvidence(w.p, w.m, inside, w.id("clip.mov"))).toBe(
			"hash",
		);
	});
});
