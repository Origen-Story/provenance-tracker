// Timelines and statements through the catalog API, over real HTTP, with the
// committed sample timeline (a Premiere export's shape: a nested sequence, a
// generator, an overlay and a stereo pair). Its paths are another machine's,
// so its files are found here by name.

import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	existsSync,
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
import { createApp } from "../../../src/server/app.ts";

const SAMPLE = readFileSync(
	path.resolve("packages/core/test/fixtures/timeline/sample.xmeml.xml"),
);
const temps: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
	for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
	for (const d of temps.splice(0))
		rmSync(d, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
});

async function world() {
	const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pt-tl-")));
	temps.push(dir);
	const home = path.join(dir, "home");
	mkdirSync(home);
	const machine: Machine = {
		platform: process.platform,
		env: {},
		home,
		settingsPath: path.join(dir, "settings.json"),
	};
	const folder = path.join(dir, "Demo");
	const media = path.join(folder, "media");
	mkdirSync(path.join(media, "exports"), { recursive: true });
	writeFileSync(path.join(media, "Clip 01.mp4"), "clip one");
	writeFileSync(path.join(media, "Still 02.png"), "still two");
	writeFileSync(path.join(media, "exports", "film.mp4"), "the cut");
	writeFileSync(path.join(media, "exports", "film-v2.mp4"), "the next cut");
	const { projectId } = createProject(folder, { name: "Demo", machine });
	updateSettings(machine.settingsPath, (s) => {
		s.person = "Settings Person";
	});
	const p = openProject(folder, { machine });
	try {
		addRoot(p, machine, {
			name: "media",
			folder: media,
			actor: { kind: "person", name: "Settings Person" },
		});
		await scanProject(p, machine);
	} finally {
		p.db.close();
	}
	const server = createApp({ env: {}, machine }).listen(0, "127.0.0.1");
	servers.push(server);
	await new Promise((r) => server.once("listening", r));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${projectId}`;
	const call = async (method: string, url: string, body?: unknown) => {
		const res = await fetch(base + url, {
			method,
			headers:
				body instanceof FormData || !body
					? {}
					: { "content-type": "application/json" },
			body:
				body instanceof FormData
					? body
					: body
						? JSON.stringify(body)
						: undefined,
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely; each test says what it expects
		const json = (await res.json()) as Record<string, any>;
		return { status: res.status, body: json };
	};
	const assets = (await call("GET", "/assets")).body.assets as Array<{
		id: number;
		file: { path: string };
	}>;
	const idOf = (p: string) => assets.find((a) => a.file.path === p)!.id;
	return {
		folder,
		call,
		film: idOf("exports/film.mp4"),
		filmV2: idOf("exports/film-v2.mp4"),
		clip: idOf("Clip 01.mp4"),
		still: idOf("Still 02.png"),
	};
}

const upload = (bytes: Buffer, name = "sample.xml") => {
	const form = new FormData();
	form.append("timeline", new Blob([bytes]), name);
	return form;
};

describe("timelines through the API", () => {
	it("imports a timeline for an output: the file kept, sources matched by name here, the output marked and classed", async () => {
		const w = await world();
		const r = await w.call(
			"POST",
			`/assets/${w.film}/timelines`,
			upload(SAMPLE),
		);
		expect(r.status).toBe(200);
		expect(r.body.import).toMatchObject({
			format: "xmeml",
			sources: 5,
			matched: 2,
		});
		const t = r.body.timeline;
		expect(t).toMatchObject({
			outputAssetId: w.film,
			fileName: "sample.xml",
			sequenceName: "Sample Sequence",
		});
		expect(
			existsSync(
				path.join(w.folder, ".provenancetracker", "timelines", t.fileSha256),
			),
		).toBe(true);
		const matched = t.sources.filter(
			(s: { assetId: number | null }) => s.assetId !== null,
		);
		expect(
			matched.map((s: { assetId: number; matchMethod: string }) => [
				s.assetId,
				s.matchMethod,
			]),
		).toEqual([
			[w.clip, "filename"],
			[w.still, "filename"],
		]);
		const film = (await w.call("GET", `/assets/${w.film}`)).body;
		expect(film.fields).toMatchObject({
			is_output: true,
			output_source: "timeline",
		});
		expect(film.timelines).toHaveLength(1);
		expect(
			film.relationships
				.map((x: { otherAssetId: number }) => x.otherAssetId)
				.sort(),
		).toEqual([w.clip, w.still].sort());
	});

	it("takes a person's corrections: a match, a clip's class, the settings; then removes the timeline", async () => {
		const w = await world();
		const t = (
			await w.call("POST", `/assets/${w.film}/timelines`, upload(SAMPLE))
		).body.timeline;
		const unmatched = t.sources.find(
			(s: { assetId: number | null; kind: string }) =>
				s.assetId === null && s.kind === "file",
		);
		const fixed = await w.call(
			"PATCH",
			`/timelines/${t.id}/sources/${unmatched.id}`,
			{ fields: { asset_id: w.clip }, note: "the same take, renamed" },
		);
		expect(fixed.status).toBe(200);
		expect(
			fixed.body.timeline.sources.find(
				(s: { id: number }) => s.id === unmatched.id,
			),
		).toMatchObject({ assetId: w.clip, matchMethod: "manual" });

		const clip = t.clips[0];
		expect(
			(
				await w.call("PATCH", `/timelines/${t.id}/clips/${clip.id}`, {
					fields: { origin_class: "screenCapture" },
				})
			).body.timeline.clips[0].originClass,
		).toBe("screenCapture");
		expect(
			(
				await w.call("PATCH", `/timelines/${t.id}/clips/${clip.id}`, {
					fields: { origin_class: "photo" },
				})
			).status,
		).toBe(400);
		expect(
			(
				await w.call("PATCH", `/timelines/${t.id}`, {
					fields: { include_overlays: true },
				})
			).body,
		).toMatchObject({
			changed: ["include_overlays"],
			timeline: { includeOverlays: true },
		});
		expect(
			(await w.call("PATCH", `/timelines/${t.id}`, { fields: { fps: 1 } }))
				.status,
		).toBe(400);

		expect((await w.call("DELETE", `/timelines/${t.id}`)).body).toEqual({
			removed: t.id,
		});
		expect((await w.call("GET", `/timelines/${t.id}`)).status).toBe(404);
	});

	it("saves statements for an output, and refuses a file that is not a timeline", async () => {
		const w = await world();
		await w.call("POST", `/assets/${w.film}/timelines`, upload(SAMPLE));
		const s = await w.call("POST", `/assets/${w.film}/statements`, {
			fields: { text: "Made from two takes and a still.", author: "A. Maker" },
		});
		expect(s.body.asset.statements).toMatchObject([
			{ text: "Made from two takes and a still.", author: "A. Maker" },
		]);
		expect(
			(
				await w.call("POST", `/assets/${w.clip}/statements`, {
					fields: { text: "x" },
				})
			).status,
		).toBe(400);
		const bad = await w.call(
			"POST",
			`/assets/${w.film}/timelines`,
			upload(Buffer.from("<html>not a timeline</html>"), "page.html"),
		);
		expect(bad.status).toBe(400);
		expect(bad.body.error).toMatch(/Unrecognised timeline format/);
		expect(
			(await w.call("POST", `/assets/${w.film}/timelines`, new FormData()))
				.status,
		).toBe(400);
	});
	it("starts a new export from an earlier edit: its statement and clip classes come across once (D50)", async () => {
		const w = await world();
		const t = (
			await w.call("POST", `/assets/${w.film}/timelines`, upload(SAMPLE))
		).body.timeline;
		await w.call("PATCH", `/timelines/${t.id}/clips/${t.clips[0].id}`, {
			fields: { origin_class: "compositeSynthetic" },
		});
		await w.call("POST", `/assets/${w.film}/statements`, {
			fields: { text: "Made from two takes and a still.", author: "A. Maker" },
		});
		await w.call("PATCH", `/assets/${w.film}`, {
			fields: { public_title: "The Film" },
		});

		expect(
			(
				await w.call("POST", `/assets/${w.filmV2}/start-from`, {
					fields: { from_id: w.film, public_title: "sneaked in" },
				})
			).status,
		).toBe(400);
		expect(
			(
				await w.call("POST", `/assets/${w.filmV2}/start-from`, {
					fields: { from_id: w.clip },
				})
			).status,
		).toBe(400);

		const r = await w.call("POST", `/assets/${w.filmV2}/start-from`, {
			fields: { from_id: w.film },
		});
		expect(r.status).toBe(200);
		expect(r.body.copied).toMatchObject({ from: w.film, statement: true });
		expect(r.body.asset.fields).toMatchObject({
			is_output: true,
			public_title: "The Film",
		});
		expect(r.body.asset.statements).toMatchObject([
			{ text: "Made from two takes and a still.", author: "A. Maker" },
		]);
		expect(r.body.asset.relationships).toContainEqual(
			expect.objectContaining({
				type: "started_from",
				// the other asset's side
				direction: "parent",
				otherAssetId: w.film,
			}),
		);

		const v2 = (
			await w.call("POST", `/assets/${w.filmV2}/timelines`, upload(SAMPLE))
		).body.timeline;
		expect(v2.clips[0].originClass).toBe("compositeSynthetic");
		expect(
			(
				await w.call("POST", `/assets/${w.filmV2}/start-from`, {
					fields: { from_id: w.film },
				})
			).status,
		).toBe(400);
	});

	it("picks the image an edit is shown by, taking only image_id, and a new export starts with it (D52)", async () => {
		const w = await world();
		await w.call("POST", `/assets/${w.film}/timelines`, upload(SAMPLE));
		for (const fields of [
			{ image_id: w.still, note: "x" },
			{ image_id: String(w.still) },
			{},
		])
			expect(
				(await w.call("PUT", `/assets/${w.film}/thumbnail`, { fields })).status,
			).toBe(400);
		// A video is not a thumbnail; a missing asset is not found.
		expect(
			(
				await w.call("PUT", `/assets/${w.film}/thumbnail`, {
					fields: { image_id: w.clip },
				})
			).status,
		).toBe(400);
		expect(
			(
				await w.call("PUT", `/assets/${w.film}/thumbnail`, {
					fields: { image_id: 9999 },
				})
			).status,
		).toBe(404);

		const r = await w.call("PUT", `/assets/${w.film}/thumbnail`, {
			fields: { image_id: w.still },
		});
		expect(r.status).toBe(200);
		expect(r.body.asset.relationships).toContainEqual(
			expect.objectContaining({
				type: "thumbnail_of",
				direction: "child",
				otherAssetId: w.still,
			}),
		);
		const copied = await w.call("POST", `/assets/${w.filmV2}/start-from`, {
			fields: { from_id: w.film },
		});
		expect(copied.body.copied.thumbnail).toBe(true);

		const cleared = await w.call("PUT", `/assets/${w.film}/thumbnail`, {
			fields: { image_id: null },
		});
		expect(
			cleared.body.asset.relationships.some(
				(l: { type: string }) => l.type === "thumbnail_of",
			),
		).toBe(false);
	});
});

describe("versions of a film through the API (D60)", () => {
	it("starts an edit as made from another, reads its revisions, and changes how it relates", async () => {
		const w = await world();
		await w.call("PATCH", `/assets/${w.film}`, { fields: { is_output: true } });
		const made = await w.call("POST", `/assets/${w.filmV2}/start-from`, {
			fields: { from_id: w.film, as: "made_from" },
		});
		expect(made.status).toBe(200);
		expect(
			made.body.asset.relationships.find(
				(r: { type: string }) => r.type === "made_from",
			),
		).toMatchObject({ direction: "parent", otherAssetId: w.film });

		const of = async (id: number) =>
			(await w.call("GET", `/assets/${id}/revisions`)).body;
		expect((await of(w.film)).deliverables).toEqual([
			expect.objectContaining({ assetId: w.filmV2, fileName: "film-v2.mp4" }),
		]);
		expect((await of(w.filmV2)).madeFrom).toMatchObject({ assetId: w.film });

		const turned = await w.call("PUT", `/assets/${w.filmV2}/relation`, {
			fields: { as: "revision" },
		});
		expect(turned.status).toBe(200);
		expect(
			turned.body.revisions.line.map((e: { assetId: number }) => e.assetId),
		).toEqual([w.film, w.filmV2]);
		expect(turned.body.revisions.madeFrom).toBeNull();

		for (const [url, fields, status] of [
			[`/assets/${w.filmV2}/relation`, { as: "sibling" }, 400],
			[`/assets/${w.filmV2}/relation`, { as: "revision", note2: 1 }, 400],
			[`/assets/${w.film}/relation`, { as: "revision" }, 400],
		] as const)
			expect((await w.call("PUT", url, { fields })).status, url).toBe(status);
		expect((await w.call("GET", "/assets/999/revisions")).status).toBe(404);
	});
});
