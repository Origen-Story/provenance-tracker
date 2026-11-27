import { describe, it, expect } from "vitest";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { incomingFolder, placeFile, targetFolder } from "../src/incoming.ts";
import { createProject, openProject } from "../src/project.ts";
import { addRoot } from "../src/roots.ts";
import { machinesForTests } from "./helpers/machine.ts";

const { machine, tempDir, track } = machinesForTests();
const ME = { kind: "person" as const, name: "Test Person" };

function project() {
	const m = machine();
	const folder = path.join(tempDir(), "Demo");
	mkdirSync(path.join(folder, "media"), { recursive: true });
	createProject(folder, { name: "Demo", machine: m });
	const p = track(openProject(folder, { machine: m }));
	addRoot(p, m, {
		name: "media",
		folder: path.join(folder, "media"),
		actor: ME,
	});
	return { m, p, folder, media: path.join(folder, "media") };
}

function received(p: { folder: string }, text: string) {
	const file = path.join(incomingFolder(p.folder), `${Math.random()}.part`);
	writeFileSync(file, text);
	return file;
}

describe("targetFolder", () => {
	it("is a root's folder, or a folder inside it, made if missing", () => {
		const { m, p, media } = project();
		expect(targetFolder(p, m, "media")).toMatchObject({
			root: "media",
			folder: media,
			subfolder: "",
		});
		const t = targetFolder(p, m, "media", "day 1/cards");
		expect(t.folder).toBe(path.join(media, "day 1", "cards"));
		expect(existsSync(t.folder)).toBe(true);
	});

	it("never leads outside the root", () => {
		const { m, p, media } = project();
		for (const bad of ["../outside", "a/../../x", "/abs", "C:/x", "a\\b"])
			expect(() => targetFolder(p, m, "media", bad), bad).toThrow(
				/not a folder inside the root/,
			);
		writeFileSync(path.join(media, "a-file"), "x");
		expect(() => targetFolder(p, m, "media", "a-file")).toThrow(
			/is a file, not a folder/,
		);
		expect(() => targetFolder(p, m, "nope")).toThrow(/no root called "nope"/);
	});
});

describe("a media folder that is, or holds, the project folder", () => {
	/** A project whose one media folder is the project folder itself, or the folder above it. */
	function withRoot(which: "project" | "above") {
		const m = machine();
		const outer = tempDir();
		const folder = path.join(outer, "Demo");
		mkdirSync(folder, { recursive: true });
		createProject(folder, { name: "Demo", machine: m });
		const p = track(openProject(folder, { machine: m }));
		addRoot(p, m, {
			name: which,
			folder: which === "project" ? folder : outer,
			actor: ME,
		});
		return { m, p, folder, outer };
	}

	it("never takes a file into the project's own catalog folder", () => {
		const own = /not added inside the project's own \.provenancetracker folder/;
		const a = withRoot("project");
		for (const sub of [
			".provenancetracker",
			".provenancetracker/backups",
			".provenancetracker/incoming",
			".provenancetracker/anything/new",
		])
			expect(() => targetFolder(a.p, a.m, "project", sub), sub).toThrow(own);
		// Nothing was made by the refused ones, and beside the catalog's folder is fine.
		expect(
			existsSync(path.join(a.folder, ".provenancetracker", "anything")),
		).toBe(false);
		expect(targetFolder(a.p, a.m, "project", "media").folder).toBe(
			path.join(a.folder, "media"),
		);

		const b = withRoot("above");
		for (const sub of [
			"Demo/.provenancetracker",
			"Demo/.provenancetracker/anything/new",
		])
			expect(() => targetFolder(b.p, b.m, "above", sub), sub).toThrow(own);
		expect(targetFolder(b.p, b.m, "above", "Demo/day 1").folder).toBe(
			path.join(b.outer, "Demo", "day 1"),
		);
	});
});

describe("placeFile", () => {
	it("moves a received file in under a safe, free name, never replacing one", async () => {
		const { m, p, media } = project();
		writeFileSync(path.join(media, "take.wav"), "first");
		const t = targetFolder(p, m, "media");
		const a = await placeFile(received(p, "second"), t, "take.wav", m);
		expect(a).toMatchObject({
			root: "media",
			path: "take (2).wav",
			renamed: true,
		});
		expect(readFileSync(path.join(media, "take.wav"), "utf8")).toBe("first");
		expect(readFileSync(path.join(media, "take (2).wav"), "utf8")).toBe(
			"second",
		);
		const b = await placeFile(
			received(p, "third"),
			targetFolder(p, m, "media", "day 1"),
			"../../Peña.wav",
			m,
		);
		expect(b).toMatchObject({ path: "day 1/Peña.wav", renamed: false });
		// Nothing is left behind in the incoming folder.
		expect(readdirSync(incomingFolder(p.folder))).toEqual([]);
	});
});
