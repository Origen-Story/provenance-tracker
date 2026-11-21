import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	renameSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import type { Actor } from "@provenancetracker/core/catalog/edit.ts";
import type { Machine } from "../src/machine.ts";
import {
	createProject,
	openProject,
	type OpenProject,
} from "../src/project.ts";
import { addRoot, locateRoot } from "../src/roots.ts";
import { scanProject, UNSORTED } from "../src/scan.ts";
import { machinesForTests } from "./helpers/machine.ts";

const t = machinesForTests();
const ME: Actor = { kind: "person", name: "A. Maker" };

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function write(
	folder: string,
	rel: string,
	text: string,
	mtime?: number,
): string {
	const file = path.join(folder, ...rel.split("/"));
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
	if (mtime !== undefined) utimesSync(file, mtime, mtime);
	return file;
}

function setup(): { m: Machine; p: OpenProject; media: string } {
	const m = t.machine();
	const made = createProject(t.folder("film"), { name: "Film", machine: m });
	const p = t.track(openProject(made.folder, { machine: m }));
	const media = t.folder("Media");
	addRoot(p, m, { name: "media", folder: media, actor: ME });
	return { m, p, media };
}

function live(p: OpenProject) {
	return p.db
		.prepare(
			`SELECT l.path, l.content_sha256 AS sha256, c.asset_id AS assetId
			 FROM locations l JOIN contents c ON c.sha256 = l.content_sha256
			 WHERE l.gone_run_id IS NULL ORDER BY l.path`,
		)
		.all() as Array<{ path: string; sha256: string; assetId: number }>;
}

describe("scanProject", () => {
	it("records every file once: a content, an unsorted asset and a location each", async () => {
		const { m, p, media } = setup();
		write(media, "day 1/a.mov", "aaa");
		write(media, "day 1/b.wav", "bbbb");
		write(media, "c.tif", "c");
		const report = await scanProject(p, m);
		expect(report.outcome).toBe("ok");
		expect(report.counts).toMatchObject({
			files: 3,
			added: 3,
			newAssets: 3,
			unchanged: 0,
			gone: 0,
			hashedBytes: 8,
		});
		expect(live(p).map((l) => [l.path, l.sha256])).toEqual([
			["c.tif", sha("c")],
			["day 1/a.mov", sha("aaa")],
			["day 1/b.wav", sha("bbbb")],
		]);
		expect(p.db.prepare("SELECT DISTINCT kind FROM assets").all()).toEqual([
			{ kind: UNSORTED },
		]);
		const run = p.db
			.prepare("SELECT kind, outcome, summary FROM runs WHERE id = ?")
			.get(report.runId) as {
			kind: string;
			outcome: string;
			summary: string;
		};
		expect(run).toMatchObject({ kind: "scan", outcome: "ok" });
		expect(JSON.parse(run.summary).counts.added).toBe(3);
		// New assets and contents are tool edits, with history naming the run.
		expect(
			p.db
				.prepare(
					"SELECT DISTINCT actor_kind, run_id FROM history WHERE table_name IN ('assets', 'contents')",
				)
				.all(),
		).toEqual([{ actor_kind: "tool", run_id: report.runId }]);
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("does not read an unchanged file again, and marks it seen", async () => {
		const { m, p, media } = setup();
		write(media, "a.mov", "aaa", 1_700_000_000);
		await scanProject(p, m);
		const second = await scanProject(p, m);
		expect(second.counts).toMatchObject({
			files: 1,
			unchanged: 1,
			added: 0,
			hashedBytes: 0,
		});
		expect(
			p.db.prepare("SELECT last_seen_run_id AS r FROM locations").get(),
		).toEqual({ r: second.runId });
	});

	it("follows a moved file, keeping its asset", async () => {
		const { m, p, media } = setup();
		write(media, "inbox/a.mov", "aaa");
		await scanProject(p, m);
		const before = live(p)[0];
		mkdirSync(path.join(media, "sorted"));
		renameSync(
			path.join(media, "inbox", "a.mov"),
			path.join(media, "sorted", "a.mov"),
		);
		const report = await scanProject(p, m);
		expect(report.counts).toMatchObject({
			moved: 1,
			added: 1,
			gone: 0,
			newAssets: 0,
		});
		expect(live(p)).toEqual([
			{ path: "sorted/a.mov", sha256: before.sha256, assetId: before.assetId },
		]);
		expect(
			p.db
				.prepare("SELECT count(*) AS n FROM locations WHERE gone_run_id = ?")
				.get(report.runId),
		).toEqual({ n: 1 });
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("treats new bytes at a known path as a new version of the same asset", async () => {
		const { m, p, media } = setup();
		write(media, "cut.mov", "cut 1", 1_700_000_000);
		await scanProject(p, m);
		const cut1 = live(p)[0];
		write(media, "cut.mov", "cut 2!", 1_700_000_100);
		const report = await scanProject(p, m);
		expect(report.counts).toMatchObject({
			replaced: 1,
			newVersions: 1,
			newAssets: 0,
		});
		const cut2 = live(p)[0];
		expect(cut2).toEqual({
			path: "cut.mov",
			sha256: sha("cut 2!"),
			assetId: cut1.assetId,
		});
		expect(
			p.db
				.prepare("SELECT count(*) AS n FROM contents WHERE asset_id = ?")
				.get(cut1.assetId),
		).toEqual({ n: 2 });
	});

	it("records a new time without a new version when only the time changed", async () => {
		const { m, p, media } = setup();
		write(media, "a.mov", "aaa", 1_700_000_000);
		await scanProject(p, m);
		utimesSync(path.join(media, "a.mov"), 1_700_000_500, 1_700_000_500);
		const report = await scanProject(p, m);
		expect(report.counts).toMatchObject({ touched: 1, added: 0, replaced: 0 });
		expect(
			p.db.prepare("SELECT modified_ms AS ms FROM locations").get(),
		).toEqual({ ms: 1_700_000_500_000 });
	});

	it("marks a deleted file gone, and keeps its content and asset", async () => {
		const { m, p, media } = setup();
		write(media, "a.mov", "aaa");
		await scanProject(p, m);
		rmSync(path.join(media, "a.mov"));
		const report = await scanProject(p, m);
		expect(report.counts.gone).toBe(1);
		expect(live(p)).toEqual([]);
		expect(p.db.prepare("SELECT count(*) AS n FROM contents").get()).toEqual({
			n: 1,
		});
	});

	it("finds identical files anywhere in the project, across roots", async () => {
		const { m, p, media } = setup();
		const other = t.folder("Archive");
		addRoot(p, m, { name: "archive", folder: other, actor: ME });
		write(media, "a.mov", "same");
		write(media, "copy of a.mov", "same");
		write(other, "deep/a.mov", "same");
		write(media, "b.mov", "different");
		const report = await scanProject(p, m);
		expect(report.counts).toMatchObject({ added: 4, newAssets: 2 });
		expect(report.duplicates).toEqual([
			{
				sha256: sha("same"),
				places: [
					{ root: "media", path: "a.mov" },
					{ root: "media", path: "copy of a.mov" },
					{ root: "archive", path: "deep/a.mov" },
				],
			},
		]);
	});

	it("leaves the files of a root that is not on this machine as they were", async () => {
		const { m, p, media } = setup();
		write(media, "a.mov", "aaa");
		await scanProject(p, m);
		// The drive is unplugged: the folder is not there.
		renameSync(media, `${media} unplugged`);
		const report = await scanProject(p, m);
		expect(report.roots).toEqual([
			{
				name: "media",
				folder: media,
				scanned: false,
				reason: "folder missing",
				files: 0,
			},
		]);
		expect(report.counts.gone).toBe(0);
		expect(live(p).length).toBe(1);
		// Plugged in again at another letter: located, scanned, nothing lost.
		locateRoot(p, m, { name: "media", folder: `${media} unplugged` });
		expect((await scanProject(p, m)).counts).toMatchObject({
			unchanged: 1,
			gone: 0,
		});
	});

	// chmod cannot lock a folder on Windows; Linux CI runs this one.
	it.skipIf(process.platform === "win32")(
		"leaves the files of a folder it cannot read as they were",
		async () => {
			const { m, p, media } = setup();
			write(media, "open/a.mov", "aaa");
			write(media, "locked/b.mov", "bbb");
			await scanProject(p, m);
			const locked = path.join(media, "locked");
			chmodSync(locked, 0o000);
			try {
				const report = await scanProject(p, m);
				expect(report.skipped).toEqual([
					{
						root: "media",
						path: "locked",
						reason: "folder could not be read (EACCES)",
					},
				]);
				expect(report.counts.gone).toBe(0);
				expect(live(p).map((l) => l.path)).toEqual([
					"locked/b.mov",
					"open/a.mov",
				]);
			} finally {
				chmodSync(locked, 0o755);
			}
		},
	);

	it("scans only the roots asked for", async () => {
		const { m, p, media } = setup();
		const other = t.folder("Archive");
		addRoot(p, m, { name: "archive", folder: other, actor: ME });
		write(media, "a.mov", "aaa");
		write(other, "b.tif", "bbb");
		await scanProject(p, m);
		rmSync(path.join(other, "b.tif"));
		const report = await scanProject(p, m, { roots: ["media"] });
		expect(report.counts).toMatchObject({ files: 1, gone: 0 });
		expect(live(p).length).toBe(2);
		await expect(scanProject(p, m, { roots: ["nope"] })).rejects.toThrow(
			'no root called "nope"',
		);
	});

	it("passes over hidden files, the project's own folder, and links", async () => {
		const m = t.machine();
		// The project folder itself as a root: its .provenancetracker folder is not media.
		const here = t.folder("Here");
		const q = t.track(
			openProject(createProject(here, { name: "Here", machine: m }).folder, {
				machine: m,
			}),
		);
		addRoot(q, m, { name: "here", folder: here, actor: ME });
		write(here, "a.mov", "aaa");
		write(here, ".DS_Store", "x");
		write(here, "._a.mov", "x");
		write(here, "Thumbs.db", "x");
		write(here, ".hidden/b.mov", "x");
		const outside = write(t.folder("Outside"), "c.mov", "ccc");
		let linked = true;
		try {
			symlinkSync(outside, path.join(here, "link.mov"));
		} catch {
			linked = false; // Windows without the right to make links
		}
		const report = await scanProject(q, m);
		expect(live(q).map((l) => l.path)).toEqual(["a.mov"]);
		expect(report.skipped).toEqual(
			linked
				? [
						{
							root: "here",
							path: "link.mov",
							reason: "a link; links are not followed",
						},
					]
				: [],
		);
	});

	it("stops between files when asked, keeping what it finished and marking nothing gone", async () => {
		const { m, p, media } = setup();
		write(media, "a.mov", "aaa");
		write(media, "gone.mov", "ggg");
		await scanProject(p, m);
		rmSync(path.join(media, "gone.mov"));
		write(media, "b.mov", "bbb");
		write(media, "c.mov", "ccc");
		const stop = new AbortController();
		const report = await scanProject(p, m, {
			signal: stop.signal,
			onProgress: (progress) => {
				if (progress.hashed === 1) stop.abort();
			},
		});
		expect(report.outcome).toBe("cancelled");
		expect(report.counts).toMatchObject({ added: 1, gone: 0 });
		expect(live(p).map((l) => l.path)).toEqual(["a.mov", "b.mov", "gone.mov"]);
		expect(
			p.db.prepare("SELECT outcome FROM runs WHERE id = ?").get(report.runId),
		).toEqual({ outcome: "cancelled" });
		// The next scan finishes the job.
		const next = await scanProject(p, m);
		expect(next.counts).toMatchObject({ added: 1, gone: 1 });
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("records the run as failed when something breaks, and rolls back the file it was on", async () => {
		const { m, p, media } = setup();
		write(media, "a.mov", "aaa");
		// A trigger standing in for a disk error while writing.
		p.db.exec(
			"CREATE TEMP TRIGGER fail BEFORE INSERT ON locations BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
		);
		await expect(scanProject(p, m)).rejects.toThrow("disk full");
		p.db.exec("DROP TRIGGER fail");
		expect(
			p.db
				.prepare("SELECT outcome, summary FROM runs WHERE kind = 'scan'")
				.get(),
		).toEqual({
			outcome: "failed",
			summary: JSON.stringify({ error: "disk full" }),
		});
		expect(p.db.prepare("SELECT count(*) AS n FROM contents").get()).toEqual({
			n: 0,
		});
		expect(verifyCatalog(p.db)).toEqual([]);
	});
});
