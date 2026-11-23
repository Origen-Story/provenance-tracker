import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import type { Actor } from "@provenancetracker/core/catalog/edit.ts";
import type { Machine } from "../src/machine.ts";
import { createProject, openProject, PROJECT_DIR } from "../src/project.ts";
import { addRoot, listRoots, locateRoot, renameRoot } from "../src/roots.ts";
import { projectEntry, readSettings, updateSettings } from "../src/settings.ts";
import { machinesForTests } from "./helpers/machine.ts";

const t = machinesForTests();
const ME: Actor = { kind: "person", name: "A. Maker" };
const NOW = "2026-11-21T12:00:00.000Z";
/** For a locate that should change only this machine's settings: it never asks who. */
const NO_ACTOR = (): Actor => {
	throw new Error("this locate should not need anyone's name");
};

function project(m: Machine = t.machine()) {
	const made = createProject(t.folder("film"), { name: "Film", machine: m });
	return { m, p: t.track(openProject(made.folder, { machine: m })) };
}

describe("addRoot", () => {
	it("names the root in the catalog, with its history, and places it on this machine", () => {
		const { m, p } = project();
		const media = t.folder("Media");
		const root = addRoot(p, m, {
			name: " media ",
			folder: media,
			note: "Day 1 cards",
			actor: ME,
			now: NOW,
		});
		expect(root).toEqual({
			id: 1,
			name: "media",
			note: "Day 1 cards",
			folder: media,
			inProject: false,
			status: "ok",
			warnings: [],
		});
		expect(
			p.db.prepare("SELECT id, name, note, created_at FROM roots").all(),
		).toEqual([{ id: 1, name: "media", note: "Day 1 cards", created_at: NOW }]);
		const history = p.db
			.prepare(
				"SELECT field, new_value, actor_kind, actor FROM history WHERE table_name = 'roots' ORDER BY field",
			)
			.all();
		expect(history).toEqual([
			{
				field: "name",
				new_value: '"media"',
				actor_kind: "person",
				actor: "A. Maker",
			},
			{
				field: "note",
				new_value: '"Day 1 cards"',
				actor_kind: "person",
				actor: "A. Maker",
			},
		]);
		expect(readSettings(m.settingsPath).projects[p.projectId].roots).toEqual({
			"1": media,
		});
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("allows the project folder itself as a root, recorded as '.'", () => {
		const { m, p } = project();
		expect(
			addRoot(p, m, { name: "here", folder: p.folder, actor: ME }),
		).toMatchObject({ status: "ok", inProject: true, folder: p.folder });
		expect(p.db.prepare("SELECT folder_in_project FROM roots").get()).toEqual({
			folder_in_project: ".",
		});
	});

	it("refuses a taken name, a missing folder, a file, a part path and the project's own folder", () => {
		const { m, p } = project();
		const media = t.folder("Media");
		addRoot(p, m, { name: "media", folder: media, actor: ME });
		const file = path.join(media, "clip.mov");
		writeFileSync(file, "");
		const cases: Array<[string, string, string]> = [
			["media", t.folder("Other"), 'already has a root called "media"'],
			["b", path.join(media, "..", "nope"), "There is no folder"],
			["c", file, "is a file, not a folder"],
			["d", "Media", "must be a full path"],
			["e", path.join(p.folder, PROJECT_DIR), "inside the project's own"],
			["  ", t.folder("Blank"), "needs a name"],
		];
		for (const [name, folder, message] of cases)
			expect(() => addRoot(p, m, { name, folder, actor: ME }), message).toThrow(
				message,
			);
		expect(p.db.prepare("SELECT count(*) AS n FROM roots").get()).toEqual({
			n: 1,
		});
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("refuses a folder that is, holds, or is inside another root on this machine", () => {
		const { m, p } = project();
		const media = t.folder("Media");
		mkdirSync(path.join(media, "Interviews"));
		addRoot(p, m, { name: "media", folder: media, actor: ME });
		expect(() =>
			addRoot(p, m, { name: "same", folder: media, actor: ME }),
		).toThrow('already the folder of the root "media"');
		expect(() =>
			addRoot(p, m, {
				name: "inside",
				folder: path.join(media, "Interviews"),
				actor: ME,
			}),
		).toThrow('overlaps the root "media"');
		expect(() =>
			addRoot(p, m, { name: "around", folder: path.dirname(media), actor: ME }),
		).toThrow('overlaps the root "media"');
	});

	it("warns, and still adds, a root inside a sync folder", () => {
		const synced = t.folder("Google");
		mkdirSync(path.join(synced, ".shortcut-targets-by-id"));
		const media = path.join(synced, "My Drive", "Footage");
		mkdirSync(media, { recursive: true });
		const { m, p } = project();
		const root = addRoot(p, m, { name: "drive", folder: media, actor: ME });
		expect(root.status).toBe("ok");
		expect(root.warnings).toEqual([
			`${media} is inside Google Drive (${synced}). Files kept online only are downloaded in full when they are scanned.`,
		]);
	});
});

describe("listRoots and locateRoot", () => {
	it("on a second machine: a copied project's roots are not located until each is pointed at a folder", () => {
		const { m, p } = project();
		const media = t.folder("Media");
		addRoot(p, m, { name: "media", folder: media, actor: ME });
		addRoot(p, m, { name: "archive", folder: t.folder("Archive"), actor: ME });
		p.db.close();

		// The laptop: its own settings, the project folder copied, the media on another drive.
		const laptop = t.machine();
		const copied = path.join(t.tempDir(), "film");
		cpSync(p.folder, copied, { recursive: true });
		const q = t.track(openProject(copied, { machine: laptop }));
		expect(
			listRoots(q, laptop).map((r) => [r.name, r.folder, r.status]),
		).toEqual([
			["media", null, "not located on this machine"],
			["archive", null, "not located on this machine"],
		]);
		const laptopMedia = t.folder("E", "Media");
		expect(
			locateRoot(q, laptop, {
				name: "media",
				folder: laptopMedia,
				actor: NO_ACTOR,
			}).folder,
		).toBe(laptopMedia);
		expect(listRoots(q, laptop).map((r) => r.status)).toEqual([
			"ok",
			"not located on this machine",
		]);
		// Locating writes nothing to the catalog: where a folder is on one machine is not the project's history.
		expect(
			q.db
				.prepare("SELECT count(*) AS n FROM history WHERE table_name = 'roots'")
				.get(),
		).toEqual({ n: 2 });
		// The first machine still has its own folders.
		expect(readSettings(m.settingsPath).projects[p.projectId].roots["1"]).toBe(
			media,
		);
	});

	it("reports a folder that has gone", () => {
		const { m, p } = project();
		const media = t.folder("Media");
		addRoot(p, m, { name: "media", folder: media, actor: ME });
		renameSync(media, `${media} old`);
		expect(listRoots(p, m)[0]).toMatchObject({
			status: "folder missing",
			folder: media,
		});
	});

	it("moves a root on this machine, still refusing overlaps with the others", () => {
		const { m, p } = project();
		const a = t.folder("A");
		const b = t.folder("B");
		addRoot(p, m, { name: "a", folder: a, actor: ME });
		addRoot(p, m, { name: "b", folder: b, actor: ME });
		const a2 = t.folder("A2");
		expect(
			locateRoot(p, m, { name: "a", folder: a2, actor: NO_ACTOR }).folder,
		).toBe(a2);
		// Moving a root to where it already is, or into its own old folder, is fine.
		expect(
			locateRoot(p, m, { name: "a", folder: a2, actor: NO_ACTOR }).status,
		).toBe("ok");
		expect(() =>
			locateRoot(p, m, { name: "a", folder: b, actor: NO_ACTOR }),
		).toThrow('already the folder of the root "b"');
		expect(() =>
			locateRoot(p, m, { name: "c", folder: a, actor: NO_ACTOR }),
		).toThrow('no root called "c" (it has: a, b)');
	});
});

describe("a root inside the project folder", () => {
	function withInsideRoot() {
		const { m, p } = project();
		const media = path.join(p.folder, "Media", "Day 1");
		mkdirSync(media, { recursive: true });
		const root = addRoot(p, m, {
			name: "media",
			folder: media,
			actor: ME,
			now: NOW,
		});
		return { m, p, media, root };
	}

	it("is recorded relative to the project folder, with its history, and not in this machine's settings", () => {
		const { m, p, media, root } = withInsideRoot();
		expect(root).toMatchObject({
			folder: media,
			inProject: true,
			status: "ok",
		});
		expect(p.db.prepare("SELECT folder_in_project FROM roots").get()).toEqual({
			folder_in_project: "Media/Day 1",
		});
		expect(
			p.db
				.prepare(
					"SELECT new_value, actor FROM history WHERE table_name = 'roots' AND field = 'folder_in_project'",
				)
				.all(),
		).toEqual([{ new_value: '"Media/Day 1"', actor: "A. Maker" }]);
		expect(readSettings(m.settingsPath).projects[p.projectId].roots).toEqual(
			{},
		);
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("travels: a project folder restored elsewhere on another machine finds it at once; a root outside does not", () => {
		const { m, p } = withInsideRoot();
		addRoot(p, m, { name: "archive", folder: t.folder("Archive"), actor: ME });
		p.db.close();

		const laptop = t.machine();
		const restored = path.join(t.tempDir(), "Restored", "film");
		cpSync(p.folder, restored, { recursive: true });
		const q = t.track(openProject(restored, { machine: laptop }));
		expect(
			listRoots(q, laptop).map((r) => [r.name, r.folder, r.status]),
		).toEqual([
			["media", path.join(restored, "Media", "Day 1"), "ok"],
			["archive", null, "not located on this machine"],
		]);
	});

	it("follows the copy it is opened from, even with a settings entry left pointing at the original", () => {
		const { m, p, media } = withInsideRoot();
		// As if this machine had placed the root itself before (an older tool, a hand edit).
		updateSettings(m.settingsPath, (s) => {
			projectEntry(s, p.projectId).roots["1"] = media;
		});
		p.db.close();
		const copy = path.join(t.tempDir(), "film copy");
		cpSync(p.folder, copy, { recursive: true });
		const q = t.track(openProject(copy, { machine: m }));
		expect(listRoots(q, m)[0].folder).toBe(path.join(copy, "Media", "Day 1"));
	});

	it("is moved within the project by locate, under the person's name; settings stay untouched", () => {
		const { m, p, media } = withInsideRoot();
		const moved = path.join(p.folder, "Footage");
		renameSync(media, moved);
		expect(listRoots(p, m)[0]).toMatchObject({
			status: "folder missing",
			folder: media,
		});
		const root = locateRoot(p, m, {
			name: "media",
			folder: moved,
			actor: () => ME,
			now: NOW,
		});
		expect(root).toMatchObject({
			folder: moved,
			inProject: true,
			status: "ok",
		});
		expect(
			p.db
				.prepare(
					"SELECT old_value, new_value FROM history WHERE field = 'folder_in_project' ORDER BY id DESC LIMIT 1",
				)
				.get(),
		).toEqual({ old_value: '"Media/Day 1"', new_value: '"Footage"' });
		expect(readSettings(m.settingsPath).projects[p.projectId].roots).toEqual(
			{},
		);
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("moves between inside and outside the project folder with locate, both ways", () => {
		const { m, p, media } = withInsideRoot();
		const outside = t.folder("Elsewhere");
		expect(
			locateRoot(p, m, { name: "media", folder: outside, actor: () => ME }),
		).toMatchObject({ folder: outside, inProject: false });
		expect(p.db.prepare("SELECT folder_in_project FROM roots").get()).toEqual({
			folder_in_project: null,
		});
		expect(readSettings(m.settingsPath).projects[p.projectId].roots).toEqual({
			"1": outside,
		});

		expect(
			locateRoot(p, m, { name: "media", folder: media, actor: () => ME }),
		).toMatchObject({ folder: media, inProject: true });
		expect(readSettings(m.settingsPath).projects[p.projectId].roots).toEqual(
			{},
		);
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("counts in the overlap check like any other root", () => {
		const { m, p } = withInsideRoot();
		expect(() =>
			addRoot(p, m, { name: "all", folder: p.folder, actor: ME }),
		).toThrow('overlaps the root "media"');
	});
});

describe("renameRoot", () => {
	it("renames in the catalog with history, and leaves this machine's settings alone", () => {
		const { m, p } = project();
		const media = t.folder("Media");
		addRoot(p, m, { name: "media", folder: media, actor: ME });
		renameRoot(p, { name: "media", newName: "footage", actor: ME, now: NOW });
		expect(listRoots(p, m).map((r) => [r.name, r.folder])).toEqual([
			["footage", media],
		]);
		const last = p.db
			.prepare(
				"SELECT old_value, new_value FROM history WHERE field = 'name' ORDER BY id DESC LIMIT 1",
			)
			.get();
		expect(last).toEqual({ old_value: '"media"', new_value: '"footage"' });
		expect(() =>
			renameRoot(p, { name: "media", newName: "x", actor: ME }),
		).toThrow('no root called "media"');
		addRoot(p, m, { name: "archive", folder: t.folder("Archive"), actor: ME });
		expect(() =>
			renameRoot(p, { name: "archive", newName: "footage", actor: ME }),
		).toThrow("already has a root");
		expect(verifyCatalog(p.db)).toEqual([]);
	});
});
