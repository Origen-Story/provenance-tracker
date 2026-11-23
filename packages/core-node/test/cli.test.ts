import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import { run, type Io } from "../src/cli/run.ts";
import type { Machine } from "../src/machine.ts";
import { catalogPathOf } from "../src/project.ts";
import { readSettings } from "../src/settings.ts";
import { machinesForTests, peek } from "./helpers/machine.ts";

const t = machinesForTests();

function cli(machine: Machine, cwd: string) {
	const out: string[] = [];
	const err: string[] = [];
	const io: Io = {
		machine,
		cwd,
		out: (l) => out.push(l),
		err: (l) => err.push(l),
	};
	return {
		run: async (...argv: string[]) => {
			out.length = 0;
			err.length = 0;
			const code = await run(argv, io);
			return { code, out: out.join("\n"), err: err.join("\n") };
		},
	};
}

describe("the command line", () => {
	it("prints help with no command, help, or --help", async () => {
		const c = cli(t.machine(), t.tempDir());
		for (const argv of [[], ["help"], ["--help"], ["roots", "-h"]]) {
			const r = await c.run(...argv);
			expect(r.code, argv.join(" ")).toBe(0);
			expect(r.out).toContain("init <folder> [--name <name>]");
		}
	});

	it("makes a project, adds and lists its roots, from a folder inside it", async () => {
		const m = t.machine();
		const work = t.tempDir();
		const c = cli(m, work);
		expect((await c.run("init", "Demo")).out).toContain(
			`Made project "Demo" in ${path.join(work, "Demo")}`,
		);
		expect((await c.run("settings", "person", "A. Maker")).code).toBe(0);

		mkdirSync(path.join(work, "Demo", "media"));
		const inside = cli(m, path.join(work, "Demo", "media"));
		const added = await inside.run(
			"roots",
			"add",
			"media",
			".",
			"--note",
			"Cards from day 1",
		);
		expect(added).toMatchObject({ code: 0, err: "" });
		expect(added.out).toContain(
			`media  ${path.join(work, "Demo", "media")}  (ok, inside the project folder)  Cards from day 1`,
		);
		expect((await inside.run("roots")).out).toMatch(
			/Project "Demo" .*\n {2}media {2}.*\(ok, inside the project folder\)/,
		);
		expect(
			(
				await inside.run(
					"roots",
					"rename",
					"media",
					"footage",
					"--by",
					"B. Editor",
				)
			).code,
		).toBe(0);
		peek(catalogPathOf(path.join(work, "Demo")), (db) => {
			expect(verifyCatalog(db)).toEqual([]);
			expect(
				db
					.prepare(
						"SELECT DISTINCT actor FROM history WHERE table_name = 'roots' ORDER BY actor",
					)
					.all(),
			).toEqual([{ actor: "A. Maker" }, { actor: "B. Editor" }]);
		});
		const shown = (await c.run("settings")).out;
		expect(shown).toContain("Person: A. Maker");
		expect(shown).toContain("0 root(s) outside the project folder placed here");
	});

	it("asks for a name before recording an edit, and changes nothing until it has one", async () => {
		const m = t.machine();
		const work = t.tempDir();
		const c = cli(m, work);
		await c.run("init", "Demo");
		const r = await c.run("roots", "add", "media", work, "--project", "Demo");
		expect(r.code).toBe(2);
		expect(r.err).toContain('settings person "Your Name"');
		peek(catalogPathOf(path.join(work, "Demo")), (db) =>
			expect(db.prepare("SELECT count(*) AS n FROM roots").get()).toEqual({
				n: 0,
			}),
		);
	});

	it("exits 2 for a typing mistake and 1 for a refusal, with the reason on stderr", async () => {
		const m = t.machine();
		const work = t.tempDir();
		const c = cli(m, work);
		expect(await c.run("frobnicate")).toMatchObject({
			code: 2,
			err: expect.stringContaining('Unknown command "frobnicate"'),
		});
		expect(await c.run("init", "--colour", "red")).toMatchObject({
			code: 2,
			err: expect.stringContaining("--colour"),
		});
		expect(await c.run("init")).toMatchObject({
			code: 2,
			err: expect.stringContaining("Usage: npm run cli -- init"),
		});
		expect((await c.run("roots", "frob", "--project", work)).code).toBe(1);
		expect(await c.run("roots")).toMatchObject({
			code: 1,
			err: expect.stringContaining("There is no project in"),
		});
		await c.run("init", "Demo");
		expect(await c.run("init", "Demo")).toMatchObject({
			code: 1,
			err: expect.stringContaining("already has a catalog"),
		});
		expect(await c.run("roots", "frob", "--project", "Demo")).toMatchObject({
			code: 2,
			err: expect.stringContaining('Unknown roots command "frob"'),
		});
	});

	it("never touches the real settings file", async () => {
		const m = t.machine();
		await cli(m, t.tempDir()).run("settings", "person", "A. Maker");
		expect(readSettings(m.settingsPath).person).toBe("A. Maker");
		expect(m.settingsPath.startsWith(path.dirname(m.home))).toBe(true);
	});
});

describe("migrate", () => {
	it("runs only as a dry run so far, and needs a layout and a name", async () => {
		const m = t.machine();
		const dir = t.tempDir();
		const c = cli(m, dir);
		const noLayout = await c.run("migrate", "--dry-run");
		expect(noLayout.code).toBe(2);
		expect(noLayout.err).toContain("migrate --dry-run --layout <file>");
		const real = await c.run("migrate", "--layout", "layout.json");
		expect(real.code).toBe(2);
		expect(real.err).toContain("Only the dry run exists so far");
		const missing = await c.run(
			"migrate",
			"--dry-run",
			"--layout",
			"layout.json",
		);
		expect(missing.code).toBe(1);
		expect(missing.err).toContain("is not readable JSON");
	});
});
