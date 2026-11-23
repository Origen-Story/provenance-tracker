// The catalog API (/api/next) over real HTTP: the app the server runs, on a
// port of its own, with a throwaway machine and project folders.

import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest, type Server } from "node:http";
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
import { editRow } from "@provenancetracker/core/catalog/edit.ts";
import type { Machine } from "@provenancetracker/core-node/machine.ts";
import {
	createProject,
	openProject,
} from "@provenancetracker/core-node/project.ts";
import { addRoot } from "@provenancetracker/core-node/roots.ts";
import { scanProject } from "@provenancetracker/core-node/scan.ts";
import { updateSettings } from "@provenancetracker/core-node/settings.ts";
import { createApp } from "../../../src/server/app.ts";

const ME = { kind: "person" as const, name: "Test Person" };
const temps: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
	for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
	for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pt-api-")));
	temps.push(dir);
	return dir;
}

function machineIn(dir: string): Machine {
	const home = path.join(dir, "home");
	mkdirSync(home, { recursive: true });
	return {
		platform: process.platform,
		env: {},
		home,
		settingsPath: path.join(dir, "settings.json"),
	};
}

/** A project with one root inside it holding two files, scanned. */
async function demoProject(machine: Machine, dir: string, name = "Demo") {
	const folder = path.join(dir, name);
	const media = path.join(folder, "media");
	mkdirSync(media, { recursive: true });
	writeFileSync(path.join(media, "interview_peña.wav"), "sound");
	writeFileSync(path.join(media, "still.png"), "picture");
	const { projectId } = createProject(folder, { name, machine });
	const project = openProject(folder, { machine });
	try {
		addRoot(project, machine, { name: "media", folder: media, actor: ME });
		await scanProject(project, machine);
		editRow(
			project.db,
			"assets",
			1,
			{ title: "Entrevista con la Señora Peña", kind: "produced" },
			{ actor: ME },
		);
	} finally {
		project.db.close();
	}
	return { projectId, folder };
}

async function serve(machine: Machine) {
	const server = createApp({ env: {}, machine }).listen(0, "127.0.0.1");
	servers.push(server);
	await new Promise((r) => server.once("listening", r));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const call = async (method: string, url: string, body?: unknown) => {
		const res = await fetch(base + url, {
			method,
			headers: body ? { "content-type": "application/json" } : {},
			body: body ? JSON.stringify(body) : undefined,
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely; each test says what it expects
		const json = (await res.json()) as Record<string, any>;
		return { status: res.status, body: json };
	};
	return {
		server,
		base,
		get: (url: string) => call("GET", url),
		post: (url: string, body?: unknown) => call("POST", url, body),
	};
}

describe("the catalog API", () => {
	it("lists this machine's projects and opens one", async () => {
		const dir = tempDir();
		const m = machineIn(dir);
		const { projectId, folder } = await demoProject(m, dir);
		const api = await serve(m);

		expect((await api.get("/api/next/projects")).body).toEqual({
			projects: [{ projectId, folder, name: "Demo", status: "ok" }],
		});
		const p = await api.get(`/api/next/projects/${projectId}`);
		expect(p.status).toBe(200);
		expect(p.body).toMatchObject({
			projectId,
			name: "Demo",
			folder,
			roots: [
				{
					name: "media",
					inProject: true,
					status: "ok",
					folder: path.join(folder, "media"),
				},
			],
			counts: { assets: 2, byKind: { produced: 1, unsorted: 1 }, unsorted: 1 },
		});
	});

	it("lists, filters and searches assets, and gives one asset's whole record", async () => {
		const dir = tempDir();
		const m = machineIn(dir);
		const { projectId } = await demoProject(m, dir);
		const api = await serve(m);
		const base = `/api/next/projects/${projectId}`;

		const all = await api.get(`${base}/assets`);
		expect(all.body.total).toBe(2);
		expect(
			all.body.assets.map((a: { displayTitle: string }) => a.displayTitle),
		).toEqual(["Entrevista con la Señora Peña", "still.png"]);
		expect(
			(await api.get(`${base}/assets?kind=unsorted`)).body.assets.map(
				(a: { id: number }) => a.id,
			),
		).toEqual([2]);
		expect(
			(await api.get(`${base}/assets?q=pena`)).body.assets.map(
				(a: { id: number }) => a.id,
			),
		).toEqual([1]);
		expect(
			(await api.get(`${base}/assets?q=still`)).body.assets.map(
				(a: { id: number }) => a.id,
			),
		).toEqual([2]);
		// Unknown query fields are ignored, never passed on.
		expect(
			(await api.get(`${base}/assets?sql=1&limit=1`)).body.assets,
		).toHaveLength(1);

		const one = await api.get(`${base}/assets/1`);
		expect(one.status).toBe(200);
		expect(one.body.fields).toMatchObject({
			kind: "produced",
			title: "Entrevista con la Señora Peña",
		});
		expect(one.body.contents[0].places).toEqual([
			{ root: "media", path: "interview_peña.wav", live: true },
		]);
		// One edit set the title and the kind; both are in the history, under the person.
		expect(
			one.body.history.find((h: { field: string }) => h.field === "title"),
		).toMatchObject({
			newValue: "Entrevista con la Señora Peña",
			actor: "Test Person",
			actorKind: "person",
		});
	});

	it("answers in JSON with the right status when something is not there", async () => {
		const dir = tempDir();
		const m = machineIn(dir);
		const { projectId, folder } = await demoProject(m, dir);
		const api = await serve(m);

		expect(await api.get(`/api/next/projects/${projectId}/assets/99`)).toEqual({
			status: 404,
			body: { error: "There is no such asset" },
		});
		expect(
			(await api.get(`/api/next/projects/${projectId}/assets/abc`)).status,
		).toBe(404);
		expect(
			(await api.get(`/api/next/projects/${projectId}/observations/99`)).status,
		).toBe(404);
		expect((await api.get("/api/next/projects/not-a-project")).status).toBe(
			404,
		);
		const unknown = await api.get(
			"/api/next/projects/00000000-0000-4000-8000-000000000000",
		);
		expect(unknown.status).toBe(404);
		expect(unknown.body.error).toMatch(/does not know that project/);

		// The folder now holds another project's catalog.
		const other = await demoProject(m, dir, "Other");
		updateSettings(m.settingsPath, (s) => {
			s.projects[projectId].folder = other.folder;
		});
		const moved = await api.get(`/api/next/projects/${projectId}`);
		expect(moved.status).toBe(409);
		expect(moved.body.error).toMatch(/now holds another project \(Other\)/);
		expect(
			(await api.get("/api/next/projects")).body.projects.find(
				(p: { projectId: string }) => p.projectId === projectId,
			),
		).toMatchObject({
			status: "another project",
		});
		expect(folder).not.toBe(other.folder);
	});

	it("opens a project folder this machine did not know, and says why one cannot be opened", async () => {
		const dir = tempDir();
		const elsewhere = machineIn(path.join(dir, "elsewhere"));
		const { projectId, folder } = await demoProject(elsewhere, dir);
		const m = machineIn(dir);
		const api = await serve(m);

		expect((await api.get("/api/next/projects")).body.projects).toEqual([]);
		const opened = await api.post("/api/next/projects/open", { folder });
		expect(opened).toEqual({
			status: 200,
			body: { projectId, name: "Demo", folder, upgraded: null },
		});
		expect(
			(await api.get("/api/next/projects")).body.projects.map(
				(p: { projectId: string }) => p.projectId,
			),
		).toEqual([projectId]);

		expect((await api.post("/api/next/projects/open", {})).status).toBe(400);
		const missing = await api.post("/api/next/projects/open", {
			folder: path.join(dir, "nothing here"),
		});
		expect(missing.status).toBe(409);
	});

	it("refuses requests that do not come from this machine's own pages", async () => {
		const dir = tempDir();
		const m = machineIn(dir);
		const { server } = await serve(m);
		const port = (server.address() as AddressInfo).port;
		const raw = (headers: Record<string, string>) =>
			new Promise<number>((resolve, reject) => {
				const req = httpRequest(
					{ host: "127.0.0.1", port, path: "/api/next/projects", headers },
					(res) => {
						res.resume();
						resolve(res.statusCode ?? 0);
					},
				);
				req.on("error", reject);
				req.end();
			});
		expect(await raw({ host: "example.com" })).toBe(403);
		expect(
			await raw({ host: `127.0.0.1:${port}`, origin: "https://example.com" }),
		).toBe(403);
		expect(await raw({ host: `127.0.0.1:${port}` })).toBe(200);
	});
});
