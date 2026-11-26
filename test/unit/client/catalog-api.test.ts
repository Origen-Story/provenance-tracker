// The new pages' API client (src/client/catalog/api.ts) against the real
// catalog API: each call the asset pages make, with the bodies they send,
// over HTTP to a throwaway project on a throwaway machine. If a page and
// the server stop agreeing on a shape, this fails.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Machine } from "@provenancetracker/core-node/machine.ts";
import {
	createProject,
	openProject,
} from "@provenancetracker/core-node/project.ts";
import { addRoot } from "@provenancetracker/core-node/roots.ts";
import { scanProject } from "@provenancetracker/core-node/scan.ts";
import { updateSettings } from "@provenancetracker/core-node/settings.ts";
import { noCredentials } from "../../../packages/core-node/test/helpers/readers.ts";
import { createApp } from "../../../src/server/app.ts";
import {
	ApiError,
	assets,
	fileUrl,
	machine,
	media,
	outputs,
	projects,
	timelineSequences,
	type Job,
} from "../../../src/client/catalog/api.ts";

const ME = { kind: "person" as const, name: "Test Person" };
let dir = "";
let server: Server | null = null;
const realFetch = globalThis.fetch;

beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pt-client-")));
});
afterEach(async () => {
	vi.unstubAllGlobals();
	if (server) await new Promise((r) => server!.close(r));
	server = null;
	rmSync(dir, { recursive: true, force: true });
});

/** A machine with a person set, a project with two files, and the client pointed at its server. */
async function world() {
	const home = path.join(dir, "home");
	mkdirSync(home, { recursive: true });
	const machine: Machine = {
		platform: process.platform,
		env: {},
		home,
		settingsPath: path.join(dir, "settings.json"),
	};
	const folder = path.join(dir, "Demo");
	const mediaDir = path.join(folder, "media");
	mkdirSync(mediaDir, { recursive: true });
	writeFileSync(path.join(mediaDir, "take.wav"), "sound");
	writeFileSync(path.join(mediaDir, "still.png"), "picture");
	const { projectId } = createProject(folder, { name: "Demo", machine });
	const project = openProject(folder, { machine });
	try {
		addRoot(project, machine, { name: "media", folder: mediaDir, actor: ME });
		await scanProject(project, machine);
	} finally {
		project.db.close();
	}
	updateSettings(machine.settingsPath, (s) => {
		s.person = "Test Person";
	});
	// A stand-in reader: this is about the calls, not what is read from the
	// files, but a file has to have been read before an edit is signed.
	server = createApp({
		env: {},
		machine,
		catalog: { readers: async () => [noCredentials] },
	}).listen(0, "127.0.0.1");
	await new Promise((r) => server!.once("listening", r));
	const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
	// The pages call relative addresses; here they go to this server.
	vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
		realFetch(base + url, init),
	);
	const list = await assets.list(projectId, {});
	const id = (name: string) =>
		list.assets.find((a) => a.file?.path === name)!.id;
	return {
		projectId,
		take: id("take.wav"),
		still: id("still.png"),
		base,
		folder,
		mediaDir,
	};
}

/** Wait for a job to end, asking as the page does. */
async function settle(projectId: string, job: Job) {
	for (let i = 0; i < 200; i++) {
		const now = (await media.jobs(projectId)).jobs.find(
			(j) => j.id === job.id,
		)!;
		if (now.state !== "running") return now;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error("the job did not finish");
}

describe("the asset pages' API client", () => {
	it("lists and filters, and reads one asset", async () => {
		const w = await world();
		expect((await projects.summary(w.projectId)).counts.assets).toBe(2);
		expect((await assets.list(w.projectId, { q: "still" })).assets).toEqual([
			expect.objectContaining({ id: w.still, kind: "unsorted" }),
		]);
		expect(
			(await assets.list(w.projectId, { kind: "unsorted", limit: 1 })).total,
		).toBe(2);
		const record = await assets.get(w.projectId, w.take);
		expect(record.contents[0].places).toEqual([
			{ root: "media", path: "take.wav", live: true },
		]);
		const preview = await realFetch(
			w.base + fileUrl(w.projectId, record.contents[0].sha256),
		);
		expect(preview.status).toBe(200);
	});

	it("saves details and a class under the person's name, with the reason", async () => {
		const w = await world();
		const r = await assets.edit(
			w.projectId,
			w.take,
			{ title: "Interview", kind: "produced", code: null },
			"named on the shoot",
		);
		expect(r.changed?.sort()).toEqual(["kind", "title"]);
		expect(r.asset.fields).toMatchObject({ title: "Interview", code: null });
		const cls = await assets.edit(w.projectId, w.take, {
			origin_class: "digitalCapture",
			origin_class_confirmed: true,
		});
		expect(cls.asset.fields).toMatchObject({
			origin_class: "digitalCapture",
			origin_class_source: "user",
		});
		expect(cls.asset.history[0]).toMatchObject({ actor: "Test Person" });
		expect(r.asset.history.find((h) => h.field === "title")?.note).toBe(
			"named on the shoot",
		);
	});

	it("adds, edits and removes a credit, and sets generation details", async () => {
		const w = await world();
		const added = await assets.addCredit(w.projectId, w.still, {
			role: "Photographer",
			name: "A. Maker",
			on_behalf_of: "",
		});
		const credit = added.asset.credits[0];
		expect(credit).toMatchObject({ role: "Photographer", name: "A. Maker" });
		const edited = await assets.editCredit(w.projectId, w.still, credit.id, {
			on_behalf_of: "Example Studio",
		});
		expect(edited.asset.credits[0].on_behalf_of).toBe("Example Studio");
		expect(
			(await assets.removeCredit(w.projectId, w.still, credit.id)).asset
				.credits,
		).toEqual([]);

		const gen = await assets.setGeneration(w.projectId, w.still, {
			platform: "example",
			steps: 20,
			width: null,
		});
		expect(gen.asset.generation).toMatchObject({
			platform: "example",
			steps: 20,
			width: null,
		});
	});

	it("links and unlinks two assets, and removes and restores one", async () => {
		const w = await world();
		const { id } = await assets.link(w.projectId, {
			parent_id: w.take,
			child_id: w.still,
			type: "ingredient",
			note: "",
		});
		expect((await assets.get(w.projectId, w.still)).relationships).toEqual([
			expect.objectContaining({
				id,
				direction: "parent",
				otherAssetId: w.take,
				matchMethod: "manual",
			}),
		]);
		await assets.unlink(w.projectId, id);
		expect((await assets.get(w.projectId, w.still)).relationships).toEqual([]);

		await assets.remove(w.projectId, w.take);
		expect(
			(await assets.list(w.projectId, { removed: "only" })).assets.map(
				(a) => a.id,
			),
		).toEqual([w.take]);
		await assets.restore(w.projectId, w.take);
		expect((await assets.list(w.projectId, {})).total).toBe(2);
	});

	it("throws the API's own words when an edit is refused", async () => {
		const w = await world();
		const refused = assets.edit(w.projectId, w.take, { owner: "x" });
		await expect(refused).rejects.toBeInstanceOf(ApiError);
		await expect(refused).rejects.toThrow(/owner/);
	});

	it("adds and edits a media folder, uploads into it as form data, and runs and lists work", async () => {
		const w = await world();
		const more = path.join(w.folder, "more");
		mkdirSync(more);
		const added = await media.addRoot(w.projectId, "more", more, "Second card");
		expect(added.roots.map((r) => r.name)).toEqual(["media", "more"]);
		const noted = await media.editRoot(w.projectId, "more", { note: "Card B" });
		expect(noted.roots[1]).toMatchObject({ note: "Card B", inProject: true });
		await expect(
			media.locateRoot(w.projectId, "more", path.join(w.folder, "nowhere")),
		).rejects.toBeInstanceOf(ApiError);

		const sent = await media.upload(w.projectId, "more", "day 1", [
			new File(["a new take"], "Plaça take.wav"),
		]);
		expect(sent.placed).toEqual([
			{ root: "more", path: "day 1/Plaça take.wav", renamed: false },
		]);
		const settle = async (job: Job) => {
			for (let i = 0; i < 200; i++) {
				const now = (await media.jobs(w.projectId)).jobs.find(
					(j) => j.id === job.id,
				)!;
				if (now.state !== "running") return now;
				await new Promise((r) => setTimeout(r, 25));
			}
			throw new Error("the job did not finish");
		};
		expect(await settle(sent.job!)).toMatchObject({
			kind: "import",
			state: "done",
		});
		expect((await assets.list(w.projectId, { q: "Plaça" })).total).toBe(1);

		const classify = await media.start(w.projectId, "classify");
		expect(await settle(classify.job)).toMatchObject({ state: "done" });
		const scan = await media.start(w.projectId, "scan", ["more"]);
		await settle(scan.job);
		expect((await media.jobs(w.projectId)).jobs.map((j) => j.kind)).toEqual([
			"scan",
			"classify",
			"import",
		]);
		await expect(media.cancel(w.projectId, "no-such-job")).rejects.toThrow(
			/no such job/,
		);
	});
});

describe("the finished edit pages' API client", () => {
	it("imports a timeline, fixes a match and a clip, previews and saves the statement, and refuses to sign unset", async () => {
		const w = await world();
		// The committed sample timeline names these files; its paths are another machine's.
		writeFileSync(path.join(w.mediaDir, "Clip 01.mp4"), "clip one");
		writeFileSync(path.join(w.mediaDir, "Still 02.png"), "still two");
		mkdirSync(path.join(w.mediaDir, "exports"));
		writeFileSync(path.join(w.mediaDir, "exports", "film.mp4"), "the cut");
		await settle(w.projectId, (await media.start(w.projectId, "scan")).job);
		// Read too: an edit is signed only once its sources have been.
		await settle(w.projectId, (await media.start(w.projectId, "extract")).job);
		const film = (await assets.list(w.projectId, { q: "film" })).assets[0].id;
		await assets.edit(w.projectId, film, { is_output: true });
		expect(
			(await assets.list(w.projectId, { outputs: true })).assets.map(
				(a) => a.id,
			),
		).toEqual([film]);

		const sample = readFileSync(
			path.resolve("packages/core/test/fixtures/timeline/sample.xmeml.xml"),
		);
		const imported = await outputs.importTimeline(
			w.projectId,
			film,
			new File([sample], "sample.xml"),
		);
		expect(imported.import.clips).toBeGreaterThan(0);
		const t = await outputs.timeline(w.projectId, imported.timeline.id);
		expect(t.outputAssetId).toBe(film);
		expect(t.breakdown?.composition?.picture?.intervals.length).toBeGreaterThan(
			0,
		);
		const file = t.sources.find((s) => s.kind === "file" && s.assetId)!;
		expect(file).toMatchObject({
			assetClass: expect.any(String),
			assetClassConfirmed: false,
		});

		// A person says a source is another asset, then that it is none.
		const picked = await outputs.matchSource(
			w.projectId,
			t.id,
			file.id,
			w.still,
		);
		expect(picked.timeline.sources.find((s) => s.id === file.id)).toMatchObject(
			{ assetId: w.still, matchMethod: "manual" },
		);
		const none = await outputs.matchSource(w.projectId, t.id, file.id, null);
		expect(none.timeline.sources.find((s) => s.id === file.id)?.assetId).toBe(
			null,
		);
		const clip = t.clips[0];
		const set = await outputs.setClipClass(
			w.projectId,
			t.id,
			clip.id,
			"digitalCreation",
		);
		expect(set.timeline.clips[0].originClass).toBe("digitalCreation");
		const back = await outputs.setClipClass(w.projectId, t.id, clip.id, null);
		expect(back.timeline.clips[0].originClass).toBe(null);

		// The preview says what stops signing until the statement is saved.
		const before = await outputs.preview(w.projectId, film);
		expect(before.blockers).toContain(
			"Write and save the creator statement before signing.",
		);
		const saved = await outputs.saveStatement(w.projectId, film, {
			text: "A cut of two clips.",
			author: "A. Maker",
			organization: "",
			edited_with: "An editor",
		});
		expect(saved.asset.statements[0]).toMatchObject({
			text: "A cut of two clips.",
			editedWith: "An editor",
		});
		const after = await outputs.preview(w.projectId, film);
		expect(after.blockers).toEqual([]);
		expect(after.statement).toMatchObject({
			text: "A cut of two clips.",
			output: { title: "film.mp4" },
		});
		expect(after.ingredientAssetIds).toHaveLength(
			after.statement!.ingredients.length,
		);

		// Nothing signs here yet: the set-up says so, a wrong path is refused, and signing fails in words.
		expect(await outputs.signing(w.projectId)).toMatchObject({
			configured: false,
			certificate: null,
		});
		await expect(
			outputs.setSigning(w.projectId, "cert.pem", "key.pem"),
		).rejects.toThrow(/full path/);
		const sign = await outputs.sign(w.projectId, film, {
			timestamp: true,
		});
		expect(await settle(w.projectId, sign.job)).toMatchObject({
			kind: "sign",
			state: "failed",
			error: expect.stringMatching(/certificate and key/),
		});
		expect(await outputs.clearSigning(w.projectId)).toMatchObject({
			configured: false,
		});

		await outputs.removeTimeline(w.projectId, t.id);
		expect((await assets.get(w.projectId, film)).timelines).toEqual([]);
		await expect(outputs.publicExport(w.projectId, 999)).rejects.toBeInstanceOf(
			ApiError,
		);
	});
});

describe("a timeline file holding several sequences (Phase 8 step 6)", () => {
	it("reads the sequences off the refusal, and imports the one chosen", async () => {
		const w = await world();
		mkdirSync(path.join(w.mediaDir, "exports"));
		writeFileSync(path.join(w.mediaDir, "exports", "film.mp4"), "the cut");
		await settle(w.projectId, (await media.start(w.projectId, "scan")).job);
		// Read too: an edit is signed only once its sources have been.
		await settle(w.projectId, (await media.start(w.projectId, "extract")).job);
		const film = (await assets.list(w.projectId, { q: "film" })).assets[0].id;
		await assets.edit(w.projectId, film, { is_output: true });
		const project = new File(
			[
				readFileSync(
					path.resolve(
						"packages/core/test/fixtures/timeline/project-export.xmeml.xml",
					),
				),
			],
			"project.xml",
		);
		// The film's length is unknown here, so the tracker will not guess.
		const refused = await outputs
			.importTimeline(w.projectId, film, project)
			.catch((e: unknown) => e);
		expect(refused).toBeInstanceOf(ApiError);
		expect(timelineSequences(refused)?.map((s) => s.name)).toEqual([
			"Film v12",
			"Assembly v1",
			"Film v11",
		]);
		expect(timelineSequences(new Error("other"))).toBeNull();
		const chosen = await outputs.importTimeline(w.projectId, film, project, 2);
		expect(chosen.import.sequence).toEqual({
			index: 2,
			name: "Film v11",
			of: 3,
			by: "chosen",
		});
	});
});

describe("the settings pages' API client", () => {
	it("sets the person, edits the project's settings, and forgets the project", async () => {
		const w = await world();
		expect(await machine.get()).toEqual({ person: "Test Person" });
		expect(await machine.setPerson("Another Person")).toEqual({
			person: "Another Person",
		});

		const r = await projects.editSettings(
			w.projectId,
			{
				name: "Demo film",
				author: "A. Maker",
				cawg_identity_url: "https://example.org/id.json",
			},
			"renamed",
		);
		expect(r.changed).toEqual(["name", "author", "cawg_identity_url"]);
		const summary = await projects.summary(w.projectId);
		expect(summary).toMatchObject({
			name: "Demo film",
			settings: { author: "A. Maker" },
		});
		await expect(
			projects.editSettings(w.projectId, { cawg_identity_url: "http://x.org" }),
		).rejects.toThrow(/https:\/\//);

		expect(await projects.forget(w.projectId)).toEqual({
			forgotten: w.projectId,
			projects: [],
		});
		await expect(projects.summary(w.projectId)).rejects.toBeInstanceOf(
			ApiError,
		);
		// Opening the folder brings it back, with its settings, as they are kept in it.
		await projects.open(w.folder);
		expect((await projects.summary(w.projectId)).name).toBe("Demo film");
	});
});
