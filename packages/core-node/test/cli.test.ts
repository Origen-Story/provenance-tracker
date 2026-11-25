import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import { fillSample } from "../../core/test/helpers/catalog.ts";
import { run, type Io } from "../src/cli/run.ts";
import type { Machine } from "../src/machine.ts";
import { catalogPathOf } from "../src/project.ts";
import { readSettings } from "../src/settings.ts";
import { devCertificate, haveOpenssl } from "./helpers/cert.ts";
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

	it("turns fetching Content Credentials stored on the web off and on (D51)", async () => {
		const m = t.machine();
		const c = cli(m, t.tempDir());
		expect((await c.run("settings")).out).toContain(
			"Content Credentials stored on the web: fetched when a file is read",
		);
		expect((await c.run("settings", "remote-credentials", "off")).code).toBe(0);
		expect(readSettings(m.settingsPath).remoteCredentials).toBe(false);
		expect((await c.run("settings")).out).toContain(
			"Content Credentials stored on the web: not fetched",
		);
		expect(
			await c.run("settings", "remote-credentials", "maybe"),
		).toMatchObject({ code: 2 });
		await c.run("settings", "remote-credentials", "on");
		expect(readSettings(m.settingsPath).remoteCredentials).toBe(true);
	});

	it("chooses what signs on this machine: the C2PA library unless set to c2patool (D53)", async () => {
		const m = t.machine();
		const c = cli(m, t.tempDir());
		expect((await c.run("settings")).out).toContain(
			"Signing engine: the C2PA library",
		);
		expect((await c.run("settings", "signing-engine", "c2patool")).code).toBe(
			0,
		);
		expect(readSettings(m.settingsPath).signingEngine).toBe("c2patool");
		expect((await c.run("settings")).out).toContain(
			"Signing engine: c2patool (the fallback)",
		);
		expect(await c.run("settings", "signing-engine", "openssl")).toMatchObject({
			code: 2,
		});
		expect(readSettings(m.settingsPath).signingEngine).toBe("c2patool");
		await c.run("settings", "signing-engine", "LIBRARY");
		expect(readSettings(m.settingsPath).signingEngine).toBe("library");
		// A sign command naming an engine that doesn't exist stops before opening anything.
		expect(await c.run("sign", "1", "--engine", "nope")).toMatchObject({
			code: 2,
		});
	});

	it.skipIf(!haveOpenssl)(
		"sets your identity for a project apart from its signing pair, says whose, and forgets it (D55)",
		async () => {
			const m = t.machine();
			const work = t.tempDir();
			const c = cli(m, work);
			await c.run("init", "Demo");
			expect((await c.run("identity", "--project", "Demo")).out).toContain(
				"No identity is set up for this project on this machine",
			);
			const id = devCertificate(work, "es256", "Test Person")!;
			const set = await c.run(
				"identity",
				"--certificate",
				id.certificate,
				"--key",
				id.privateKey,
				"--project",
				"Demo",
			);
			expect(set.code).toBe(0);
			expect(set.out).toContain("Signed files say they are by Test Person");
			const projectId = Object.keys(readSettings(m.settingsPath).projects)[0];
			const entry = readSettings(m.settingsPath).projects[projectId];
			expect(entry.identity).toEqual({
				certificate: id.certificate,
				privateKey: id.privateKey,
			});
			expect(entry.signing).toBeUndefined();
			expect(
				await c.run(
					"identity",
					"--certificate",
					id.certificate,
					"--project",
					"Demo",
				),
			).toMatchObject({ code: 2 });
			await c.run("identity", "--clear", "--project", "Demo");
			expect(
				readSettings(m.settingsPath).projects[projectId].identity,
			).toBeUndefined();
		},
	);

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
	it("takes --dry-run or --write, and a layout", async () => {
		const m = t.machine();
		const dir = t.tempDir();
		const c = cli(m, dir);
		const noLayout = await c.run("migrate", "--dry-run");
		expect(noLayout.code).toBe(2);
		expect(noLayout.err).toContain(
			"migrate (--dry-run | --write) --layout <file>",
		);
		// One of the two, never both or neither.
		for (const flags of [[], ["--dry-run", "--write"]]) {
			const r = await c.run("migrate", ...flags, "--layout", "layout.json");
			expect(r.code).toBe(2);
			expect(r.err).toContain("(--dry-run | --write)");
		}
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

describe("classify", () => {
	it("says what it would change on a dry run, then what it changed", async () => {
		const m = t.machine();
		const work = t.tempDir();
		const c = cli(m, work);
		await c.run("init", "Demo");
		await c.run("settings", "person", "A. Maker");
		mkdirSync(path.join(work, "Demo", "media"));
		writeFileSync(path.join(work, "Demo", "media", "note.txt"), "words");
		const inside = cli(m, path.join(work, "Demo"));
		await inside.run("roots", "add", "media", "media");
		await inside.run("scan");
		const dry = await inside.run("classify", "--dry-run");
		expect(dry).toMatchObject({ code: 0, err: "" });
		// Nothing has been read from the file, so there is nothing to say about it.
		expect(dry.out).toContain("1 asset(s) looked at; 0 would change.");
		expect(dry.out).toContain("Dry run: nothing was written.");
		const real = await inside.run("classify");
		expect(real.out).toContain("1 asset(s) looked at; 0 changed.");
		expect((await inside.run("classify", "extra")).code).toBe(2);
	});
});

describe("publish (D56)", () => {
	it("lists where a finished edit's signed copies are published, and sets the newest's", async () => {
		const m = t.machine();
		const work = t.tempDir();
		const c = cli(m, work);
		await c.run("init", "Demo");
		await c.run("settings", "person", "A. Maker");
		const folder = path.join(work, "Demo");
		// The sample's rows: a film with one signed copy, already published.
		const film = peekWrite(catalogPathOf(folder), (db) => {
			fillSample(db);
			return Number(
				(
					db.prepare("SELECT asset_id FROM signatures LIMIT 1").get() as {
						asset_id: number;
					}
				).asset_id,
			);
		});
		const p = cli(m, folder);
		const listed = await p.run("publish", String(film));
		expect(listed).toMatchObject({ code: 0 });
		expect(listed.out).toContain("Signed copy v1:");
		expect(listed.out).toContain(
			"signed file: https://media.example.org/film.signed.v1.mp4",
		);

		const set = await p.run(
			"publish",
			String(film),
			"--file",
			"",
			"--page",
			"https://example.org/films/demo",
			"--note",
			"Moved off the old host",
		);
		expect(set).toMatchObject({ code: 0 });
		expect(set.out).toContain("signed file: (not published)");
		expect(set.out).toContain("page:        https://example.org/films/demo");

		expect(
			await p.run("publish", String(film), "--file", "http://example.org/a"),
		).toMatchObject({ code: 1, err: expect.stringContaining("https://") });
		expect(
			await p.run("publish", String(film), "--version", "2", "--page", ""),
		).toMatchObject({
			code: 1,
			err: "Asset " + film + " has no signed copy v2",
		});
		expect(await p.run("publish", "1")).toMatchObject({
			code: 1,
			err: expect.stringContaining("has no signed copy"),
		});
		expect(await p.run("publish")).toMatchObject({ code: 2 });

		peek(catalogPathOf(folder), (db) => {
			expect(verifyCatalog(db)).toEqual([]);
			const last = db
				.prepare(
					"SELECT actor, field, new_value, note FROM history WHERE table_name = 'publications' ORDER BY id DESC LIMIT 1",
				)
				.get();
			expect(last).toEqual({
				actor: "A. Maker",
				field: "page_url",
				new_value: '"https://example.org/films/demo"',
				note: "Moved off the old host",
			});
		});
	});
});

/** Write to a project's catalog directly, as a test's setup. */
function peekWrite<T>(file: string, fn: (db: DatabaseSync) => T): T {
	const db = new DatabaseSync(file);
	try {
		db.exec("PRAGMA foreign_keys = ON");
		return fn(db);
	} finally {
		db.close();
	}
}
