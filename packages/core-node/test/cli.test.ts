import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import { fillSample } from "../../core/test/helpers/catalog.ts";
import type { WaitingHost } from "@provenancetracker/core/catalog/on-the-web.ts";
import { run, waitingLines, type Io } from "../src/cli/run.ts";
import type { Machine } from "../src/machine.ts";
import { catalogPathOf } from "../src/project.ts";
import { readSettings, type Settings } from "../src/settings.ts";
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

	it("chooses what this machine does about Content Credentials stored on the web: nothing until told (D74)", async () => {
		const m = t.machine();
		const c = cli(m, t.tempDir());
		const shown = (await c.run("settings")).out;
		expect(shown).toContain(
			"Content Credentials stored on the web: this machine has not been told what to do, so it fetches nothing.",
		);
		expect(shown).toContain(
			"Choose with: npm run cli -- settings credentials-on-the-web never|listed|any",
		);
		expect(shown).toContain("On the list: cai-manifests.adobe.com");

		const listed = await c.run("settings", "credentials-on-the-web", "LISTED");
		expect(listed.code).toBe(0);
		expect(listed.out).toContain(
			"this machine fetches them only from the hosts on its list.",
		);
		expect(listed.out).toContain("npm run cli -- extract");
		expect(readSettings(m.settingsPath).credentialsOnTheWeb).toEqual({
			mode: "listed",
		});

		// A host is added, left, and forgotten; a whole address is taken for its host.
		expect(
			(
				await c.run(
					"settings",
					"credentials-on-the-web",
					"allow",
					"https://Credentials.Example.org/m/1",
				)
			).out,
		).toContain("credentials.example.org is on this machine's list.");
		expect((await c.run("settings", "credentials-on-the-web")).out).toContain(
			"On the list: cai-manifests.adobe.com, credentials.example.org",
		);
		await c.run(
			"settings",
			"credentials-on-the-web",
			"leave",
			"cai-manifests.adobe.com",
		);
		const after = (await c.run("settings", "credentials-on-the-web")).out;
		expect(after).toContain("On the list: credentials.example.org");
		expect(after).toContain("Left: cai-manifests.adobe.com");
		expect(
			(
				await c.run(
					"settings",
					"credentials-on-the-web",
					"forget",
					"cai-manifests.adobe.com",
				)
			).out,
		).toContain("it stays on the built-in list");
		expect(readSettings(m.settingsPath).credentialsOnTheWeb).toEqual({
			mode: "listed",
			hosts: ["credentials.example.org"],
			left: [],
		});

		for (const mode of ["never", "any"] as const) {
			const set = await c.run("settings", "credentials-on-the-web", mode);
			expect(set.code).toBe(0);
			expect(readSettings(m.settingsPath).credentialsOnTheWeb?.mode).toBe(mode);
		}
		expect((await c.run("settings")).out).toContain(
			"this machine fetches them from any host.",
		);
		// The list is kept, and said to be out of force.
		expect(
			(
				await c.run(
					"settings",
					"credentials-on-the-web",
					"allow",
					"example.net",
				)
			).out,
		).toContain('in force only in the "listed" mode');

		for (const bad of [
			["maybe"],
			["allow"],
			["allow", "localhost"],
			["allow", "10.0.0.1"],
			["listed", "extra"],
		])
			expect(
				await c.run("settings", "credentials-on-the-web", ...bad),
				bad.join(" "),
			).toMatchObject({ code: 2 });
		// The command before D74 says what replaced it, and changes nothing.
		const old = await c.run("settings", "remote-credentials", "off");
		expect(old.code).toBe(2);
		expect(old.err).toContain("settings credentials-on-the-web");
		expect(readSettings(m.settingsPath).credentialsOnTheWeb?.mode).toBe("any");
	});

	it("says, for each host whose files were not fetched, what the person can do (D74)", () => {
		const waiting = (
			host: string | null,
			outcome: WaitingHost["outcome"] = "not-chosen",
			detail: string | null = null,
		): WaitingHost => ({
			host,
			files: 2,
			address: host ? `https://${host}/m/1` : "http://plain.example.org/m",
			outcome,
			detail,
		});
		const settings = (c: Settings["credentialsOnTheWeb"]): Settings => ({
			format: 1,
			projects: {},
			credentialsOnTheWeb: c,
		});
		const set = "npm run cli -- settings credentials-on-the-web";
		expect(
			waitingLines(settings(undefined), [waiting("a.example.org")]),
		).toEqual([
			`2 file(s) keep their Content Credentials on the web at a.example.org; not fetched, because this machine has not been told whether to. Choose: ${set} never|listed|any`,
		]);
		// The choice is one for every host, so it is asked for once.
		expect(
			waitingLines(settings(undefined), [
				waiting("a.example.org"),
				{ ...waiting("b.example.org"), files: 1 },
			]),
		).toEqual([
			`3 file(s) keep their Content Credentials on the web (2 at a.example.org, 1 at b.example.org); not fetched, because this machine has not been told whether to. Choose: ${set} never|listed|any`,
		]);
		expect(
			waitingLines(settings({ mode: "listed", left: ["b.example.org"] }), [
				waiting("a.example.org"),
				waiting("b.example.org"),
				waiting("cai-manifests.adobe.com"),
				waiting(
					"cai-manifests.adobe.com",
					"failed",
					"the server answered with status 503",
				),
				waiting(
					null,
					"refused",
					"only https addresses are fetched, and this one is http",
				),
			]),
		).toEqual([
			`2 file(s) keep their Content Credentials on the web at a.example.org, which is not on this machine's list; not fetched. To allow it: ${set} allow a.example.org   To leave it: ${set} leave a.example.org`,
			`2 file(s) keep their Content Credentials on the web at b.example.org, which this machine was told to leave; not fetched. To allow it after all: ${set} allow b.example.org`,
			"2 file(s) keep their Content Credentials on the web at cai-manifests.adobe.com; this machine would fetch them now. Read them with: npm run cli -- extract",
			"2 file(s) keep their Content Credentials on the web at cai-manifests.adobe.com; they could not be fetched (the server answered with status 503). extract tries again.",
			"2 file(s) keep their Content Credentials on the web at http://plain.example.org/m; not fetched: only https addresses are fetched, and this one is http.",
		]);
		expect(
			waitingLines(settings({ mode: "never" }), [waiting("a.example.org")]),
		).toEqual([
			`2 file(s) keep their Content Credentials on the web at a.example.org; not fetched, because this machine never fetches them. To change that: ${set} listed`,
		]);
		expect(waitingLines(settings({ mode: "any" }), [])).toEqual([]);
	});

	it("chooses what signs on this machine: the C2PA library unless set to c2patool (D53)", async () => {
		const m = t.machine();
		const c = cli(m, t.tempDir());
		expect((await c.run("settings")).out).toContain(
			"Signing engine: the C2PA library",
		);
		// c2patool fetches Content Credentials on the web from any address by
		// itself, so it is taken only by a machine set to do the same (D74).
		const refused = await c.run("settings", "signing-engine", "c2patool");
		expect(refused.code).toBe(2);
		expect(refused.err).toContain("settings credentials-on-the-web any");
		expect(readSettings(m.settingsPath).signingEngine).toBeUndefined();
		await c.run("settings", "credentials-on-the-web", "any");
		expect((await c.run("settings", "signing-engine", "c2patool")).code).toBe(
			0,
		);
		expect(readSettings(m.settingsPath).signingEngine).toBe("c2patool");
		// Nor is the setting narrowed while c2patool signs.
		const narrowed = await c.run(
			"settings",
			"credentials-on-the-web",
			"listed",
		);
		expect(narrowed.code).toBe(2);
		expect(narrowed.err).toContain("settings signing-engine library");
		expect(readSettings(m.settingsPath).credentialsOnTheWeb?.mode).toBe("any");
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
