import { afterAll, describe, expect, it } from "vitest";
import {
	mkdirSync,
	renameSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Actor } from "@provenancetracker/core/catalog/edit.ts";
import { run, type Io } from "../src/cli/run.ts";
import { endExifTool } from "../src/extract/exiftool.ts";
import type { Machine } from "../src/machine.ts";
import {
	createProject,
	openProject,
	type OpenProject,
} from "../src/project.ts";
import { addRoot } from "../src/roots.ts";
import { scanProject } from "../src/scan.ts";
import { describeFile } from "../src/show.ts";
import { verifyProject } from "../src/verify.ts";
import { machinesForTests } from "./helpers/machine.ts";

const t = machinesForTests();
const ME: Actor = { kind: "person", name: "A. Maker" };
afterAll(() => endExifTool());

function put(folder: string, rel: string, text: string): string {
	const file = path.join(folder, ...rel.split("/"));
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
	return file;
}

async function setup(): Promise<{ m: Machine; p: OpenProject; media: string }> {
	const m = t.machine();
	const made = createProject(t.folder("film"), { name: "Film", machine: m });
	const p = t.track(openProject(made.folder, { machine: m }));
	const media = t.folder("Media");
	addRoot(p, m, { name: "media", folder: media, actor: ME });
	put(media, "a.mov", "aaaa");
	put(media, "b.wav", "bbbb");
	await scanProject(p, m);
	return { m, p, media };
}

describe("verifyProject", () => {
	it("finds a sound catalog and every file as it was", async () => {
		const { m, p } = await setup();
		const before = p.db.prepare("SELECT count(*) AS n FROM runs").get();
		expect(await verifyProject(p, m)).toEqual({
			catalog: [],
			checked: 2,
			hashed: 0,
			files: [],
			notChecked: [],
			outcome: "ok",
		});
		expect((await verifyProject(p, m, { hash: true })).hashed).toBe(2);
		// It changes nothing: not even a run.
		expect(p.db.prepare("SELECT count(*) AS n FROM runs").get()).toEqual(
			before,
		);
	});

	it("reports a missing file and one changed since the scan", async () => {
		const { m, p, media } = await setup();
		rmSync(path.join(media, "a.mov"));
		put(media, "b.wav", "bbbb and more");
		expect((await verifyProject(p, m)).files).toEqual([
			{ root: "media", path: "a.mov", problem: "missing" },
			{ root: "media", path: "b.wav", problem: "changed since the last scan" },
		]);
	});

	it("with --hash, catches bytes that changed while size and time stayed the same", async () => {
		const { m, p, media } = await setup();
		const file = path.join(media, "a.mov");
		// A whole-second time survives being set and read back exactly.
		utimesSync(file, 1_700_000_000, 1_700_000_000);
		await scanProject(p, m);
		writeFileSync(file, "aaab"); // same size
		utimesSync(file, 1_700_000_000, 1_700_000_000); // time put back, as a restore tool might
		expect((await verifyProject(p, m)).files).toEqual([]);
		expect((await verifyProject(p, m, { hash: true })).files).toEqual([
			{
				root: "media",
				path: "a.mov",
				problem: "bytes differ from the catalog's hash",
				detail: "size and modified time are unchanged",
			},
		]);
	});

	it("says which roots it could not check here", async () => {
		const { m, p, media } = await setup();
		renameSync(media, `${media} unplugged`);
		const report = await verifyProject(p, m);
		expect(report).toMatchObject({
			checked: 0,
			files: [],
			notChecked: [{ root: "media", reason: "folder missing", files: 2 }],
		});
	});

	it("reports what the catalog check finds", async () => {
		const { m, p } = await setup();
		p.db.exec(
			"UPDATE roots SET note = 'edited around the history' WHERE id = 1",
		);
		const report = await verifyProject(p, m);
		expect(report.catalog).toEqual([
			expect.objectContaining({
				check: "history",
				table: "roots",
				field: "note",
			}),
		]);
		p.db.exec("UPDATE roots SET note = '' WHERE id = 1");
	});
});

describe("describeFile and the command line", () => {
	it("show: a file's asset, bytes, twins and readings; verify: exit code 0, then 1", async () => {
		const { m, p, media } = await setup();
		put(media, "copy/a.mov", "aaaa");
		await scanProject(p, m);
		p.db.close();
		const out: string[] = [];
		const io: Io = {
			machine: m,
			cwd: media,
			out: (l) => out.push(l),
			err: (l) => out.push(l),
		};
		expect(await run(["extract", "--project", p.folder], io)).toBe(0);
		out.length = 0;
		expect(await run(["show", "a.mov", "--project", p.folder], io)).toBe(0);
		expect(out[0]).toBe("media/a.mov");
		expect(out).toContain("  same bytes at media/copy/a.mov");
		expect(out.some((l) => /^ {2}exif: ok, exiftool \d/.test(l))).toBe(true);
		out.length = 0;
		expect(await run(["verify", "--hash", "--project", p.folder], io)).toBe(0);
		expect(out.at(-1)).toBe("All good.");
		rmSync(path.join(media, "b.wav"));
		out.length = 0;
		expect(await run(["verify", "--project", p.folder], io)).toBe(1);
		expect(out).toContain("  media/b.wav: missing");
		const q = t.track(openProject(p.folder, { machine: m }));
		expect(() =>
			describeFile(q, m, put(t.folder("Elsewhere"), "x.mov", "x")),
		).toThrow("not inside any of this project's roots");
		expect(() => describeFile(q, m, put(media, "new.mov", "new"))).toThrow(
			"not in the catalog yet",
		);
	});
});
