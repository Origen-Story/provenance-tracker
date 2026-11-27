// A project from someone else (D68). A catalog is a database file, and a
// database file can carry a trigger the tracker never wrote. These tests make
// such catalogs the way anyone could, with plain SQL on the file, and hold
// the tracker to opening none of them.

import { describe, expect, it } from "vitest";
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	RELEASED_SQL,
	schemaDifferences,
	schemaObjects,
} from "@provenancetracker/core/catalog/schema-check.ts";
import { CATALOG_FORMAT } from "@provenancetracker/core/catalog/format.ts";
import { makeObservation } from "@provenancetracker/core/extraction/observation.ts";
import {
	formatSchema,
	openCatalogFile,
	structureRefusal,
} from "../src/catalog-file.ts";
import {
	catalogPathOf,
	createProject,
	openProject,
	ProjectElsewhereError,
} from "../src/project.ts";
import { extractProject } from "../src/extract.ts";
import { knownProjects } from "../src/projects.ts";
import { addRoot } from "../src/roots.ts";
import { scanProject } from "../src/scan.ts";
import { identityUrlOf } from "../src/sign/sign-output.ts";
import { verifyProject } from "../src/verify.ts";
import { readSettings, updateSettings, projectEntry } from "../src/settings.ts";
import { machinesForTests } from "./helpers/machine.ts";

const t = machinesForTests();
const ME = { kind: "person" as const, name: "Test Person" };

/** A project made the ordinary way, closed, ready to be tampered with. */
function made() {
	const m = t.machine();
	const project = createProject(t.folder("film"), { name: "Film", machine: m });
	return { m, ...project };
}

/** Change a catalog file as someone with a database tool could. */
function tamper(catalogPath: string, sql: string) {
	const db = new DatabaseSync(catalogPath);
	try {
		db.exec(sql);
	} finally {
		db.close();
	}
}

const SAMPLES = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"core",
	"test",
	"fixtures",
	"catalog",
);

describe("a catalog the tracker refuses", () => {
	it("is left exactly as it was: the same files beside it, the same bytes", () => {
		for (const [what, sql, words] of [
			[
				"a table of its own",
				"CREATE TABLE extra (x TEXT)",
				/Nothing was changed/,
			],
			["a newer format", "PRAGMA user_version = 99", /Nothing was changed/],
			[
				"another program's mark",
				"PRAGMA application_id = 42",
				/Nothing was changed/,
			],
		] as const) {
			const { m, folder, catalogPath } = made();
			tamper(catalogPath, `${sql}; PRAGMA wal_checkpoint(TRUNCATE);`);
			const dir = path.dirname(catalogPath);
			const before = {
				files: readdirSync(dir).sort(),
				bytes: readFileSync(catalogPath),
			};
			expect(() => openProject(folder, { machine: m }), what).toThrow(words);
			// "Nothing was changed" is the whole truth: no journal or shared
			// memory file is left beside it either.
			expect(readdirSync(dir).sort(), what).toEqual(before.files);
			expect(readFileSync(catalogPath).equals(before.bytes), what).toBe(true);
		}
	});
});

describe("a catalog's structure against its format's (D68)", () => {
	it("is the same for a new catalog, and for each released format's sample", () => {
		const { catalogPath } = made();
		const db = openCatalogFile(catalogPath, { readOnly: true });
		try {
			expect(structureRefusal(db, CATALOG_FORMAT)).toBeNull();
		} finally {
			db.close();
		}
		for (const format of Object.keys(RELEASED_SQL).map(Number)) {
			const sample = new DatabaseSync(path.join(SAMPLES, `v${format}.sqlite`), {
				readOnly: true,
			});
			try {
				expect(
					schemaDifferences(schemaObjects(sample), formatSchema(format)!),
					`format ${format}`,
				).toEqual([]);
			} finally {
				sample.close();
			}
		}
		// Every format this tracker opens has its SQL here.
		expect(Object.keys(RELEASED_SQL).map(Number)).toContain(CATALOG_FORMAT);
	});

	it("leaves SQLite's own statistics tables out of the comparison", () => {
		const { catalogPath } = made();
		tamper(catalogPath, "ANALYZE");
		const db = openCatalogFile(catalogPath, { readOnly: true });
		try {
			expect(
				db
					.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'sqlite_stat1'")
					.get(),
			).toBeDefined();
			expect(structureRefusal(db, CATALOG_FORMAT)).toBeNull();
		} finally {
			db.close();
		}
	});
});

describe("openProject and a catalog that is not as the tracker made it (D68)", () => {
	const cases: Array<[string, string, RegExp]> = [
		[
			// The attack itself: a trigger that fires on an update signing makes,
			// and changes what a source is said to be.
			"a trigger that rewrites a source when a timeline is touched",
			`CREATE TRIGGER quiet AFTER UPDATE ON timelines BEGIN
			   UPDATE assets SET origin_class = 'digitalCapture', public_title = 'Changed';
			 END`,
			/it has a trigger named "quiet" on "timelines", which the format does not/,
		],
		[
			"a view",
			"CREATE VIEW peek AS SELECT * FROM assets",
			/it has a view named "peek", which the format does not/,
		],
		[
			"a table of its own",
			"CREATE TABLE extra (x TEXT)",
			/it has a table named "extra", which the format does not/,
		],
		[
			// The triggers that keep history from being rewritten are part of the
			// structure: a catalog without one is not the format either.
			"a protective trigger taken away",
			"DROP TRIGGER observations_fixed",
			/it has no trigger named "observations_fixed"/,
		],
		[
			"a table the format has, reworded",
			"ALTER TABLE assets ADD COLUMN hidden TEXT",
			/its table "assets" is not as the format defines it/,
		],
	];
	for (const [what, sql, message] of cases)
		it(`refuses a catalog with ${what}, and changes nothing`, () => {
			const { m, folder, catalogPath, projectId } = made();
			tamper(catalogPath, sql);
			const before = readFileSync(catalogPath);
			expect(() => openProject(folder, { machine: m })).toThrow(message);
			expect(() => openProject(folder, { machine: m })).toThrow(
				/Nothing was changed/,
			);
			expect(readFileSync(catalogPath).equals(before)).toBe(true);
			// And it is listed as what it is, not read further.
			expect(knownProjects(m)).toMatchObject([
				{ projectId, status: "not readable", name: null },
			]);
		});

	it("refuses it before an upgrade would run on it, leaving no backup", () => {
		const { m, folder, catalogPath } = made();
		tamper(catalogPath, "CREATE TABLE extra (x TEXT)");
		const step = {
			from: CATALOG_FORMAT,
			to: CATALOG_FORMAT + 1,
			sql: `CREATE TABLE later (x TEXT) STRICT; PRAGMA user_version = ${CATALOG_FORMAT + 1};`,
		};
		expect(() =>
			openProject(folder, {
				machine: m,
				upgrade: { steps: [step], target: CATALOG_FORMAT + 1 },
			}),
		).toThrow(/structure is not that format's/);
		expect(readdirSync(path.dirname(catalogPath))).not.toContain("backups");
	});
});

describe("every connection to a catalog (D68)", () => {
	it("is in defensive mode and trusts nothing in the schema, read-only ones too", () => {
		const { m, folder, catalogPath } = made();
		const p = t.track(openProject(folder, { machine: m }));
		const look = openCatalogFile(catalogPath, { readOnly: true });
		try {
			for (const db of [p.db, look])
				expect(db.prepare("PRAGMA trusted_schema").get()).toEqual({
					trusted_schema: 0,
				});
			// Defensive mode: the schema table cannot be written, even asked nicely.
			p.db.exec("PRAGMA writable_schema = ON");
			expect(() =>
				p.db.exec("UPDATE sqlite_schema SET sql = 'x' WHERE name = 'assets'"),
			).toThrow(/may not be modified/);
			// And a trigger cannot be slipped in past the open afterwards without
			// the next open seeing it.
			p.db.exec("CREATE TRIGGER late AFTER UPDATE ON meta BEGIN SELECT 1; END");
		} finally {
			look.close();
		}
		p.db.close();
		expect(() => openProject(folder, { machine: m })).toThrow(
			/it has a trigger named "late"/,
		);
	});
});

describe("what a catalog says, taken with care (D68)", () => {
	/** A project with one file in a media folder, scanned. */
	async function scanned() {
		const m = t.machine();
		const project = createProject(t.folder("film"), {
			name: "Film",
			machine: m,
		});
		const p = t.track(openProject(project.folder, { machine: m }));
		const media = t.folder("Media");
		mkdirSync(path.join(media, "sub"));
		writeFileSync(path.join(media, "sub", "clip.txt"), "a clip");
		addRoot(p, m, { name: "media", folder: media, actor: ME });
		await scanProject(p, m);
		return { m, p, media };
	}

	it("never opens a file by a path that is not a plain path inside its media folder", async () => {
		const { m, p } = await scanned();
		// The catalog's own rules let "." through; the tracker's resolver does not.
		// A second place for the same bytes, written as no scan would write it.
		t.writtenAround(p.catalogPath);
		p.db
			.prepare(
				`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
				 SELECT content_sha256, root_id, 'sub/./clip.txt', modified_ms, first_seen_run_id, last_seen_run_id FROM locations`,
			)
			.run();
		const opened: string[] = [];
		const report = await extractProject(p, m, {
			readers: [
				{
					kind: "exif",
					extractor: "stub",
					version: "1",
					read: async (file) => {
						opened.push(file);
						return makeObservation({
							kind: "exif",
							extractor: "stub",
							version: "1",
							status: "absent",
						});
					},
				},
			],
		});
		expect(report.skipped).toEqual([
			{
				root: "media",
				path: "sub/./clip.txt",
				reason: "its path in the catalog is not a path inside its media folder",
			},
		]);
		expect(opened.map((f) => path.basename(f))).toEqual(["clip.txt"]);
		expect(opened[0]).not.toContain(`${path.sep}.${path.sep}`);

		const verified = await verifyProject(p, m, { hash: true });
		expect(verified.files).toEqual([
			{
				root: "media",
				path: "sub/./clip.txt",
				problem:
					"its path in the catalog is not a path inside its media folder",
			},
		]);
		expect(verified.checked).toBe(1);
	});

	it("takes an identity link only when it is an https address, even written straight into the file (D75)", async () => {
		const { p } = await scanned();
		expect(identityUrlOf(p)).toBe("");
		const set = (value: string) =>
			p.db
				.prepare(
					"INSERT INTO meta (key, value) VALUES ('cawg_identity_url', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
				)
				.run(value);
		set("https://example.org/me");
		expect(identityUrlOf(p)).toBe("https://example.org/me");
		// Past the edit that checks it: the catalog itself refuses now.
		for (const bad of [
			"javascript:alert(1)",
			"http://example.org/me",
			"file:///C:/x",
		])
			expect(() => set(bad), bad).toThrow(
				/identity link is a web address starting https:\/\//,
			);
		expect(identityUrlOf(p)).toBe("https://example.org/me");
		// Leave the catalog as its own check expects it.
		p.db.prepare("DELETE FROM meta WHERE key = 'cawg_identity_url'").run();
	});

	it("does not sign an identity link that is not https, left in a catalog from before it was refused", () => {
		const m = t.machine();
		const project = createProject(t.folder("film"), {
			name: "Film",
			machine: m,
		});
		// A format 2 catalog had nothing to stop this; format 3's rule is for
		// what is written from now on, so the link is still there after the
		// upgrade, and signing is what refuses it.
		cpSync(path.join(SAMPLES, "v2.sqlite"), project.catalogPath);
		tamper(
			project.catalogPath,
			"INSERT INTO meta (key, value) VALUES ('cawg_identity_url', 'http://example.org/me')",
		);
		t.writtenAround(project.catalogPath);
		const p = t.track(
			openProject(project.folder, { machine: m, takeOver: true }),
		);
		expect(p.upgraded).toMatchObject({ from: 2, to: CATALOG_FORMAT });
		expect(() => identityUrlOf(p)).toThrow(
			/identity link is not a web address starting https:\/\//,
		);
	});
});

describe("a catalog with the id of a project this machine has elsewhere (D68)", () => {
	/** A project with signing set up here, and a copy of its folder. */
	function withCopy() {
		const m = t.machine();
		const original = createProject(t.folder("film"), {
			name: "Film",
			machine: m,
		});
		updateSettings(m.settingsPath, (s) => {
			projectEntry(s, original.projectId).signing = {
				certificate: "C:\\certs\\chain.pem",
				privateKey: "C:\\certs\\key.pem",
			};
		});
		const copy = path.join(t.tempDir(), "film copy");
		cpSync(original.folder, copy, { recursive: true });
		return { m, original, copy };
	}
	const entry = (m: ReturnType<typeof t.machine>, id: string) =>
		readSettings(m.settingsPath).projects[id];

	it("does not hand the signing set-up to a second copy unasked", () => {
		const { m, original, copy } = withCopy();
		let refused: unknown;
		try {
			openProject(copy, { machine: m });
		} catch (err) {
			refused = err;
		}
		expect(refused).toBeInstanceOf(ProjectElsewhereError);
		expect(refused).toMatchObject({
			projectId: original.projectId,
			known: original.folder,
		});
		expect((refused as Error).message).toMatch(/Nothing was changed/);
		// The project is still where it was, with its set-up.
		expect(entry(m, original.projectId)).toMatchObject({
			folder: original.folder,
			signing: { privateKey: "C:\\certs\\key.pem" },
		});
		// The original still opens, as before.
		t.track(openProject(original.folder, { machine: m }));
	});

	it("moves it when the person says this is where the project lives now", () => {
		const { m, original, copy } = withCopy();
		const p = t.track(openProject(copy, { machine: m, takeOver: true }));
		expect(p.projectId).toBe(original.projectId);
		expect(entry(m, original.projectId)).toMatchObject({
			folder: p.folder,
			signing: { privateKey: "C:\\certs\\key.pem" },
		});
	});

	it("follows a project that was really moved, without asking", () => {
		const { m, original, copy } = withCopy();
		rmSync(catalogPathOf(original.folder));
		const p = t.track(openProject(copy, { machine: m }));
		expect(entry(m, original.projectId).folder).toBe(p.folder);
	});

	it("follows it too when the old folder now holds another project", () => {
		const { m, original, copy } = withCopy();
		// Another project made where the first one was.
		rmSync(path.join(original.folder, ".provenancetracker"), {
			recursive: true,
		});
		const other = t.machine();
		createProject(original.folder, { name: "Another", machine: other });
		const p = t.track(openProject(copy, { machine: m }));
		expect(entry(m, original.projectId).folder).toBe(p.folder);
	});
});
