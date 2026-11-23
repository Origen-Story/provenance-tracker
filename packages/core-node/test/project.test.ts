import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APPLICATION_ID } from "@provenancetracker/core/catalog/format.ts";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import {
	catalogPathOf,
	createProject,
	findProjectFolder,
	GITIGNORE_TEXT,
	NoCatalogError,
	openProject,
	PROJECT_DIR,
	realFolder,
} from "../src/project.ts";
import { readSettings } from "../src/settings.ts";
import { TOOL } from "../src/tool.ts";
import { machinesForTests, peek } from "./helpers/machine.ts";

const t = machinesForTests();
const NOW = "2026-11-21T12:00:00.000Z";

describe("createProject", () => {
	it("makes a checked catalog, registers it on this machine, and leaves nothing else behind", () => {
		const m = t.machine();
		const folder = path.join(t.tempDir(), "Demo film");
		const made = createProject(folder, {
			name: " Demo film ",
			machine: m,
			now: NOW,
		});
		expect(made.folder).toBe(folder);
		expect(made.catalogPath).toBe(
			path.join(folder, PROJECT_DIR, "catalog.sqlite"),
		);
		expect(readdirSync(path.join(folder, PROJECT_DIR)).sort()).toEqual([
			".gitignore",
			"catalog.sqlite",
		]);
		peek(made.catalogPath, (db) => {
			expect(verifyCatalog(db)).toEqual([]);
			const meta = Object.fromEntries(
				(
					db.prepare("SELECT key, value FROM meta").all() as Array<{
						key: string;
						value: string;
					}>
				).map((r) => [r.key, r.value]),
			);
			expect(meta).toMatchObject({
				project_id: made.projectId,
				name: "Demo film",
				created_at: NOW,
				created_with: `${TOOL.name} ${TOOL.version}`,
			});
		});
		expect(readSettings(m.settingsPath).projects).toEqual({
			[made.projectId]: { folder, roots: {} },
		});
	});

	it("keeps the catalog out of git when the project folder is a repository, without touching the repository's .gitignore", () => {
		const folder = t.folder("video");
		const git = (...args: string[]) =>
			spawnSync("git", args, { cwd: folder, encoding: "utf8" });
		expect(git("init", "-q").status).toBe(0);
		writeFileSync(path.join(folder, ".gitignore"), "renders/\n");
		createProject(folder, { name: "Video", machine: t.machine() });
		expect(
			readFileSync(path.join(folder, PROJECT_DIR, ".gitignore"), "utf8"),
		).toBe(GITIGNORE_TEXT);
		const status = git("status", "--porcelain", "--untracked-files=all");
		expect(status.status).toBe(0);
		expect(status.stdout.trim()).toBe("?? .gitignore");
		expect(readFileSync(path.join(folder, ".gitignore"), "utf8")).toBe(
			"renders/\n",
		);
	});

	it("leaves a .gitignore already in .provenancetracker as it is", () => {
		const folder = t.folder("film");
		mkdirSync(path.join(folder, PROJECT_DIR));
		writeFileSync(path.join(folder, PROJECT_DIR, ".gitignore"), "mine\n");
		createProject(folder, { name: "Film", machine: t.machine() });
		expect(
			readFileSync(path.join(folder, PROJECT_DIR, ".gitignore"), "utf8"),
		).toBe("mine\n");
	});

	it("refuses a folder that already has a catalog, and leaves it as it was", () => {
		const m = t.machine();
		const folder = t.folder("film");
		const first = createProject(folder, { name: "First", machine: m });
		const before = readFileSync(first.catalogPath);
		expect(() => createProject(folder, { name: "Second", machine: m })).toThrow(
			"already has a catalog",
		);
		expect(readFileSync(first.catalogPath).equals(before)).toBe(true);
		expect(Object.keys(readSettings(m.settingsPath).projects)).toEqual([
			first.projectId,
		]);
	});

	it("refuses a folder inside a sync folder, before making anything", () => {
		const synced = t.folder("OneDrive");
		const m = t.machine({ env: { OneDrive: synced } });
		const folder = path.join(synced, "Projects", "film");
		expect(() => createProject(folder, { name: "Film", machine: m })).toThrow(
			/inside OneDrive .*the OneDrive environment variable.*corrupt a catalog/s,
		);
		expect(existsSync(path.join(synced, "Projects"))).toBe(false);
		expect(existsSync(m.settingsPath)).toBe(false);
	});

	it("refuses a project with no name, or a path that is not full, before making anything", () => {
		const m = t.machine();
		const folder = path.join(t.tempDir(), "film");
		expect(() => createProject(folder, { name: "  ", machine: m })).toThrow(
			"needs a name",
		);
		expect(() => createProject("film", { name: "Film", machine: m })).toThrow(
			"full path",
		);
		expect(existsSync(folder)).toBe(false);
	});

	it("refuses a file where the folder should be", () => {
		const file = path.join(t.tempDir(), "film");
		writeFileSync(file, "");
		expect(() =>
			createProject(file, { name: "Film", machine: t.machine() }),
		).toThrow("is a file, not a folder");
	});
});

describe("openProject", () => {
	it("opens with foreign keys on, trusted schema off and WAL, and reads the project", () => {
		const m = t.machine();
		const made = createProject(t.folder("film"), { name: "Film", machine: m });
		const p = t.track(openProject(made.folder, { machine: m }));
		expect(p).toMatchObject({
			projectId: made.projectId,
			name: "Film",
			folder: made.folder,
			upgraded: null,
		});
		const pragma = (name: string) =>
			Object.values(p.db.prepare(`PRAGMA ${name}`).get()!)[0];
		expect(pragma("journal_mode")).toBe("wal");
		expect(pragma("foreign_keys")).toBe(1);
		expect(pragma("trusted_schema")).toBe(0);
		expect(pragma("busy_timeout")).toBe(5000);
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("says how to make a catalog when there is none, and makes nothing", () => {
		const folder = t.folder("empty");
		expect(() => openProject(folder, { machine: t.machine() })).toThrow(
			new NoCatalogError(folder),
		);
		expect(() => openProject(folder, { machine: t.machine() })).toThrow(
			`There is no catalog in ${folder}.`,
		);
		expect(readdirSync(folder)).toEqual([]);
	});

	it("refuses another program's database, an empty file, and a newer catalog, changing nothing", () => {
		const m = t.machine();
		const cases: Array<[string, (file: string) => void, string]> = [
			[
				"foreign",
				(file) => {
					const db = new DatabaseSync(file);
					db.exec(
						"CREATE TABLE notes (x TEXT); INSERT INTO notes VALUES ('mine')",
					);
					db.close();
				},
				"not a Provenance Tracker catalog",
			],
			[
				"empty",
				(file) => writeFileSync(file, ""),
				"is an empty file, not a catalog",
			],
			[
				"newer",
				(file) => {
					const db = new DatabaseSync(file);
					db.exec(
						`CREATE TABLE meta (key TEXT); PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = 99;`,
					);
					db.close();
				},
				"format 99, and this version of Provenance Tracker reads formats up to 1",
			],
		];
		for (const [label, make, message] of cases) {
			const folder = t.folder(label);
			mkdirSync(path.join(folder, PROJECT_DIR));
			const file = catalogPathOf(folder);
			make(file);
			const before = readFileSync(file);
			expect(() => openProject(folder, { machine: m }), label).toThrow(message);
			expect(readFileSync(file).equals(before), label).toBe(true);
			expect(readdirSync(path.dirname(file)), label).toEqual([
				"catalog.sqlite",
			]);
		}
		expect(existsSync(m.settingsPath)).toBe(false);
	});

	it("refuses a catalog that has been moved into a sync folder", () => {
		const made = createProject(t.folder("film"), {
			name: "Film",
			machine: t.machine(),
		});
		const synced = t.folder("Dropbox");
		writeFileSync(path.join(synced, ".dropbox"), "");
		const moved = path.join(synced, "film");
		cpSync(made.folder, moved, { recursive: true });
		expect(() => openProject(moved, { machine: t.machine() })).toThrow(
			"inside Dropbox",
		);
	});

	it("copies an older catalog to backups/ and checks the copy before upgrading it", () => {
		const m = t.machine();
		const made = createProject(t.folder("film"), { name: "Film", machine: m });
		const step = {
			from: 1,
			to: 2,
			sql: "CREATE TABLE added_in_2 (x TEXT) STRICT; PRAGMA user_version = 2;",
		};
		const p = t.track(
			openProject(made.folder, {
				machine: m,
				now: NOW,
				upgrade: { steps: [step], target: 2 },
			}),
		);
		const backup = "backups/catalog.format-1.2026-11-21T12-00-00-000Z.sqlite";
		expect(p.upgraded).toEqual({ from: 1, to: 2, backup });
		const run = p.db
			.prepare("SELECT tool, summary FROM runs WHERE kind = 'upgrade'")
			.get() as {
			tool: string;
			summary: string;
		};
		expect(run.tool).toBe(TOOL.name);
		expect(JSON.parse(run.summary)).toEqual({ from: 1, to: 2, backup });
		// The copy is the catalog as it was: format 1, without the new table.
		peek(path.join(path.dirname(made.catalogPath), backup), (copy) => {
			expect(copy.prepare("PRAGMA user_version").get()).toEqual({
				user_version: 1,
			});
			expect(
				copy
					.prepare("SELECT name FROM sqlite_schema WHERE name = 'added_in_2'")
					.get(),
			).toBeUndefined();
			expect(verifyCatalog(copy)).toEqual([]);
		});
	});

	it("keeps the copy, and the catalog as it was, when an upgrade step fails", () => {
		const m = t.machine();
		const made = createProject(t.folder("film"), { name: "Film", machine: m });
		const bad = {
			from: 1,
			to: 2,
			sql: "CREATE TABLE half (x TEXT); SELECT no_such_function();",
		};
		expect(() =>
			openProject(made.folder, {
				machine: m,
				now: NOW,
				upgrade: { steps: [bad], target: 2 },
			}),
		).toThrow("no_such_function");
		const backups = readdirSync(
			path.join(path.dirname(made.catalogPath), "backups"),
		);
		expect(backups).toEqual([
			"catalog.format-1.2026-11-21T12-00-00-000Z.sqlite",
		]);
		const p = t.track(openProject(made.folder, { machine: m }));
		expect(
			p.db.prepare("SELECT name FROM sqlite_schema WHERE name = 'half'").get(),
		).toBeUndefined();
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("records where the project now is when its folder has moved", () => {
		const m = t.machine();
		const made = createProject(t.folder("film"), { name: "Film", machine: m });
		const moved = path.join(t.tempDir(), "film moved");
		cpSync(made.folder, moved, { recursive: true });
		t.track(openProject(moved, { machine: m }));
		expect(readSettings(m.settingsPath).projects[made.projectId].folder).toBe(
			moved,
		);
	});
});

describe("findProjectFolder and realFolder", () => {
	it("find the project from any folder inside it", () => {
		const made = createProject(t.folder("film"), {
			name: "Film",
			machine: t.machine(),
		});
		const deep = path.join(made.folder, "media", "day 1");
		mkdirSync(deep, { recursive: true });
		expect(findProjectFolder(deep)).toBe(made.folder);
		expect(findProjectFolder(made.folder)).toBe(made.folder);
		expect(findProjectFolder(t.folder("elsewhere"))).toBeNull();
	});

	it("resolve the part of a folder that exists, and keep the rest", () => {
		const dir = t.tempDir();
		expect(realFolder(path.join(dir, "not", "yet"))).toBe(
			path.join(dir, "not", "yet"),
		);
	});
});
