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
import { createApp } from "../../../src/server/app.ts";
import {
	ApiError,
	assets,
	fileUrl,
	projects,
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
	const media = path.join(folder, "media");
	mkdirSync(media, { recursive: true });
	writeFileSync(path.join(media, "take.wav"), "sound");
	writeFileSync(path.join(media, "still.png"), "picture");
	const { projectId } = createProject(folder, { name: "Demo", machine });
	const project = openProject(folder, { machine });
	try {
		addRoot(project, machine, { name: "media", folder: media, actor: ME });
		await scanProject(project, machine);
	} finally {
		project.db.close();
	}
	updateSettings(machine.settingsPath, (s) => {
		s.person = "Test Person";
	});
	server = createApp({ env: {}, machine }).listen(0, "127.0.0.1");
	await new Promise((r) => server!.once("listening", r));
	const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
	// The pages call relative addresses; here they go to this server.
	vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
		realFetch(base + url, init),
	);
	const list = await assets.list(projectId, {});
	const id = (name: string) =>
		list.assets.find((a) => a.file?.path === name)!.id;
	return { projectId, take: id("take.wav"), still: id("still.png"), base };
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
});
