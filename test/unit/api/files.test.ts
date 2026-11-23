// Getting files in through the catalog API, over real HTTP: roots, jobs,
// uploads and downloads. ExifTool is replaced by a stand-in reader, and the
// network by a stand-in fetch, so the test reads no real tool and goes nowhere.

import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeObservation } from "@provenancetracker/core/extraction/observation.ts";
import type { Reader } from "@provenancetracker/core-node/extract.ts";
import type { Machine } from "@provenancetracker/core-node/machine.ts";
import { createProject } from "@provenancetracker/core-node/project.ts";
import { updateSettings } from "@provenancetracker/core-node/settings.ts";
import { createApp } from "../../../src/server/app.ts";
import { JobRunner } from "../../../src/server/api/jobs.ts";

const temps: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
	for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
	// A job a failed test left running may still hold a file open for a moment.
	for (const d of temps.splice(0))
		rmSync(d, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
});

const EXIF: Reader = {
	kind: "exif",
	extractor: "exiftool",
	version: "13.0",
	read: async (f) =>
		makeObservation({
			kind: "exif",
			extractor: "exiftool",
			version: "13.0",
			status: "ok",
			data: { FileType: path.extname(f).slice(1) },
		}),
};

/** A stand-in web: each address answers as given. */
function web(
	pages: Record<
		string,
		{ status?: number; type: string; body: string; disposition?: string }
	>,
) {
	return async (url: string) => {
		const page = pages[url];
		if (!page)
			return new Response("not found", {
				status: 404,
				statusText: "Not Found",
			});
		const headers: Record<string, string> = { "content-type": page.type };
		if (page.disposition) headers["content-disposition"] = page.disposition;
		return new Response(page.body, { status: page.status ?? 200, headers });
	};
}

async function world(pages: Parameters<typeof web>[0] = {}) {
	const dir = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), "pt-files-")),
	);
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
	mkdirSync(media, { recursive: true });
	const { projectId } = createProject(folder, { name: "Demo", machine });
	updateSettings(machine.settingsPath, (s) => {
		s.person = "Settings Person";
	});
	const jobs = new JobRunner();
	const server = createApp({
		env: {},
		machine,
		catalog: {
			jobs,
			readers: async () => [EXIF],
			fetchImpl: web(pages),
			// Every host is a public address here; the guard's own tests cover refusals.
			lookup: async () => [{ address: "93.184.216.34" }],
		},
	}).listen(0, "127.0.0.1");
	servers.push(server);
	await new Promise((r) => server.once("listening", r));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/next/projects/${projectId}`;
	const call = async (method: string, url: string, body?: unknown) => {
		const res = await fetch(base + url, {
			method,
			headers:
				body instanceof FormData
					? {}
					: body
						? { "content-type": "application/json" }
						: {},
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
	const finished = async (job: { id: string }) => (await jobs.settled(job.id))!;
	return { dir, folder, media, call, finished, jobs, projectId };
}

describe("roots through the API", () => {
	it("adds, notes, renames and locates a root, and refuses one that cannot be", async () => {
		const w = await world();
		const added = await w.call("POST", "/roots", {
			fields: { name: "media", folder: w.media, note: "Day one" },
		});
		expect(added.status).toBe(200);
		expect(added.body.roots).toMatchObject([
			{ name: "media", note: "Day one", inProject: true, status: "ok" },
		]);
		expect(
			(
				await w.call("PATCH", "/roots/media", {
					fields: { name: "footage", note: "Cards" },
				})
			).body.roots,
		).toMatchObject([{ name: "footage", note: "Cards" }]);
		const moved = path.join(w.folder, "moved");
		mkdirSync(moved);
		expect(
			(
				await w.call("POST", "/roots/footage/locate", {
					fields: { folder: moved },
				})
			).body.roots[0].folder,
		).toBe(moved);

		expect(
			(
				await w.call("POST", "/roots", {
					fields: { name: "x", folder: path.join(w.dir, "nothing") },
				})
			).status,
		).toBe(400);
		expect(
			(
				await w.call("POST", "/roots", {
					fields: { name: "inner", folder: moved },
				})
			).body.error,
		).toMatch(/already the folder of the root/);
		expect(
			(await w.call("PATCH", "/roots/footage", { fields: { folder: "x" } }))
				.status,
		).toBe(400);
	});
});

describe("adding files", () => {
	it("takes uploads into a folder inside a root, never replacing a file, and imports them", async () => {
		const w = await world();
		await w.call("POST", "/roots", {
			fields: { name: "media", folder: w.media },
		});
		mkdirSync(path.join(w.media, "day 1"));
		writeFileSync(path.join(w.media, "day 1", "take.wav"), "already here");

		const form = new FormData();
		form.append("files", new Blob(["new take"]), "take.wav");
		form.append("files", new Blob(["a still"]), "Plaça Reial.png");
		const r = await w.call(
			"POST",
			`/files?root=media&folder=${encodeURIComponent("day 1")}`,
			form,
		);
		expect(r.status).toBe(202);
		expect(r.body.placed).toEqual([
			{ root: "media", path: "day 1/take (2).wav", renamed: true },
			{ root: "media", path: "day 1/Plaça Reial.png", renamed: false },
		]);
		expect(readFileSync(path.join(w.media, "day 1", "take.wav"), "utf8")).toBe(
			"already here",
		);
		expect(
			readdirSync(path.join(w.folder, ".provenancetracker", "incoming")),
		).toEqual([]);

		const job = await w.finished(r.body.job);
		expect(job).toMatchObject({ state: "done", kind: "import" });
		expect(job.result).toMatchObject({
			scan: { counts: { added: 3, newAssets: 3 } },
			extract: { written: { "exif ok": 3 } },
			classify: { examined: 3 },
		});
		const list = await w.call("GET", "/assets");
		expect(
			list.body.assets
				.map((a: { file: { path: string } }) => a.file.path)
				.sort(),
		).toEqual([
			"day 1/Plaça Reial.png",
			"day 1/take (2).wav",
			"day 1/take.wav",
		]);
	});

	it("refuses an upload while other work runs, before taking any of it", async () => {
		const w = await world();
		await w.call("POST", "/roots", {
			fields: { name: "media", folder: w.media },
		});
		let release = () => {};
		const held = w.jobs.start(
			w.projectId,
			"scan",
			() => new Promise<void>((r) => (release = r)),
		);
		const form = () => {
			const f = new FormData();
			f.append("files", new Blob(["new take"]), "take.wav");
			return f;
		};
		const refused = await w.call("POST", "/files?root=media", form());
		expect(refused.status).toBe(409);
		expect(refused.body.error).toMatch(
			/busy.*Add the files when it has finished/,
		);
		expect(readdirSync(w.media)).toEqual([]);
		release();
		await w.jobs.settled(held.id);
		const taken = await w.call("POST", "/files?root=media", form());
		expect(taken.status).toBe(202);
		expect((await w.finished(taken.body.job)).state).toBe("done");
	});

	it("refuses a folder outside the root, an unknown root and an empty upload, keeping nothing", async () => {
		const w = await world();
		await w.call("POST", "/roots", {
			fields: { name: "media", folder: w.media },
		});
		const form = () => {
			const f = new FormData();
			f.append("files", new Blob(["x"]), "x.wav");
			return f;
		};
		expect(
			(await w.call("POST", "/files?root=media&folder=..%2F..", form())).body
				.error,
		).toMatch(/not a folder inside the root/);
		expect(
			(await w.call("POST", "/files?root=nope", form())).body.error,
		).toMatch(/no root called "nope"/);
		expect(
			(await w.call("POST", "/files?root=media", new FormData())).status,
		).toBe(400);
		expect(existsSync(path.join(w.dir, "x.wav"))).toBe(false);
		expect(readdirSync(w.media)).toEqual([]);
	});

	it("downloads a picture into a root, imports it, and records where it came from as the person's edit", async () => {
		const url = "https://archive.example/items/42/full";
		const w = await world({
			[url]: {
				type: "image/jpeg; charset=binary",
				body: "jpeg bytes",
				disposition: `attachment; filename*=UTF-8''Pla%C3%A7a%201910`,
			},
		});
		await w.call("POST", "/roots", {
			fields: { name: "media", folder: w.media },
		});
		const r = await w.call("POST", "/downloads", {
			fields: { url, root: "media", folder: "archive" },
		});
		expect(r.status).toBe(202);
		const job = await w.finished(r.body.job);
		expect(job).toMatchObject({
			state: "done",
			kind: "download",
			result: {
				placed: { root: "media", path: "archive/Plaça 1910.jpg" },
				mediaType: "image/jpeg",
				size: 10,
			},
		});
		expect(
			readFileSync(path.join(w.media, "archive", "Plaça 1910.jpg"), "utf8"),
		).toBe("jpeg bytes");
		const asset = await w.call(
			"GET",
			`/assets/${(job.result as { assetId: number }).assetId}`,
		);
		expect(asset.body.fields).toMatchObject({
			source_url: url,
			access_date: new Date().toISOString().slice(0, 10),
		});
		expect(
			asset.body.history.find(
				(h: { field: string }) => h.field === "source_url",
			),
		).toMatchObject({ actor: "Settings Person", actorKind: "person" });
	});

	it("fails a download that is not a picture, video or sound, or not there, keeping nothing", async () => {
		const w = await world({
			"https://site.example/page": { type: "text/html", body: "<html>" },
		});
		await w.call("POST", "/roots", {
			fields: { name: "media", folder: w.media },
		});
		const page = await w.finished(
			(
				await w.call("POST", "/downloads", {
					fields: { url: "https://site.example/page", root: "media" },
				})
			).body.job,
		);
		expect(page).toMatchObject({
			state: "failed",
			error: expect.stringMatching(/not a picture, video or sound/),
		});
		const gone = await w.finished(
			(
				await w.call("POST", "/downloads", {
					fields: { url: "https://site.example/gone.jpg", root: "media" },
				})
			).body.job,
		);
		expect(gone).toMatchObject({
			state: "failed",
			error: "The address answered 404 Not Found",
		});
		expect(
			(
				await w.call("POST", "/downloads", {
					fields: { url: "https://x.example/a.jpg", root: "media", name: "x" },
				})
			).status,
		).toBe(400);
		expect(readdirSync(w.media)).toEqual([]);
		expect(
			readdirSync(path.join(w.folder, ".provenancetracker", "incoming")),
		).toEqual([]);
	});
});

describe("jobs through the API", () => {
	it("starts a scan, reports it, and refuses a kind it does not know", async () => {
		const w = await world();
		await w.call("POST", "/roots", {
			fields: { name: "media", folder: w.media },
		});
		writeFileSync(path.join(w.media, "a.wav"), "sound");
		const started = await w.call("POST", "/jobs", { fields: { kind: "scan" } });
		expect(started.status).toBe(202);
		expect(await w.finished(started.body.job)).toMatchObject({
			state: "done",
			result: { counts: { added: 1 } },
		});
		expect(
			(await w.call("GET", `/jobs/${started.body.job.id}`)).body.job.state,
		).toBe("done");
		expect(
			(await w.call("GET", "/jobs")).body.jobs.map(
				(j: { kind: string }) => j.kind,
			),
		).toEqual(["scan"]);
		expect(
			(await w.call("POST", "/jobs", { fields: { kind: "format-disk" } }))
				.status,
		).toBe(400);
		expect((await w.call("GET", "/jobs/nope")).status).toBe(404);
	});
});
