// Content Credentials a file keeps on the web (D74), through the API: this
// machine's choice, one host at a time on or off its lists, and what a
// project is waiting on. Over real HTTP on a port of its own; the reader is a
// stand-in, so no test reaches the network.

import { afterEach, describe, expect, it } from "vitest";
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
import { libraryObservation } from "@provenancetracker/core/extraction/c2pa-library-read.ts";
import { decideFetch } from "@provenancetracker/core/extraction/web-credentials.ts";
import type { Reader } from "@provenancetracker/core-node/extract.ts";
import type { Machine } from "@provenancetracker/core-node/machine.ts";
import {
	createProject,
	openProject,
} from "@provenancetracker/core-node/project.ts";
import { addRoot } from "@provenancetracker/core-node/roots.ts";
import { scanProject } from "@provenancetracker/core-node/scan.ts";
import {
	readSettings,
	updateSettings,
	webCredentialChoiceOf,
} from "@provenancetracker/core-node/settings.ts";
import { createApp } from "../../../src/server/app.ts";
import { JobRunner } from "../../../src/server/api/jobs.ts";
import { expectSoundCatalogs } from "../../../packages/core-node/test/helpers/verify-catalogs.ts";

const ME = { kind: "person" as const, name: "Test Person" };
const temps: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
	for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
	try {
		expectSoundCatalogs(temps);
	} finally {
		for (const d of temps.splice(0))
			rmSync(d, { recursive: true, force: true });
	}
});

function machineHere(): { m: Machine; dir: string } {
	const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pt-web-")));
	temps.push(dir);
	const home = path.join(dir, "home");
	mkdirSync(home, { recursive: true });
	return {
		dir,
		m: {
			platform: process.platform,
			env: {},
			home,
			settingsPath: path.join(dir, "settings.json"),
		},
	};
}

const ADOBE = "cai-manifests.adobe.com";
const OTHER = "credentials.example.org";

/**
 * A stand-in for the library: a file named for a host keeps its credentials
 * there ("cai-manifests.adobe.com.1.mp4"), and they are fetched or not as
 * this machine is set.
 */
function webReader(m: Machine, calls: string[]): Reader {
	return {
		kind: "c2pa",
		extractor: "c2pa-node",
		version: "9.9.9",
		read: async (file) => {
			calls.push(path.basename(file));
			const base = { kind: "c2pa" as const, version: "9.9.9" };
			const host = /^(.+)\.\d\.mp4$/.exec(path.basename(file))?.[1];
			if (!host) return libraryObservation({ ...base, store: null });
			const address = `https://${host}/manifests/${path.basename(file)}`;
			const d = decideFetch(
				webCredentialChoiceOf(readSettings(m.settingsPath)),
				address,
			);
			return d.fetch
				? libraryObservation({
						...base,
						store: { active_manifest: "m", manifests: { m: {} } },
						fetchedFrom: address,
					})
				: libraryObservation({ ...base, onTheWeb: d.onTheWeb });
		},
	};
}

async function serve(files: string[]) {
	const { m, dir } = machineHere();
	const folder = path.join(dir, "Demo");
	const media = path.join(folder, "media");
	mkdirSync(media, { recursive: true });
	for (const f of files) writeFileSync(path.join(media, f), `bytes of ${f}`);
	const { projectId } = createProject(folder, { name: "Demo", machine: m });
	const project = openProject(folder, { machine: m });
	try {
		addRoot(project, m, { name: "media", folder: media, actor: ME });
		await scanProject(project, m);
	} finally {
		project.db.close();
	}
	const calls: string[] = [];
	const jobs = new JobRunner();
	const server = createApp({
		env: {},
		machine: m,
		catalog: { jobs, readers: async () => [webReader(m, calls)] },
	}).listen(0, "127.0.0.1");
	servers.push(server);
	await new Promise((r) => server.once("listening", r));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
	const call = async (method: string, url: string, fields?: unknown) => {
		const res = await fetch(base + url, {
			method,
			headers: fields ? { "content-type": "application/json" } : {},
			body: fields ? JSON.stringify({ fields }) : undefined,
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely; each test says what it expects
		const body = (await res.json()) as Record<string, any>;
		return { status: res.status, body };
	};
	const read = async () => {
		calls.length = 0;
		const started = await call("POST", `/projects/${projectId}/jobs`, {
			kind: "extract",
		});
		expect(started.status).toBe(202);
		const job = await jobs.settled(started.body.job.id);
		expect(job?.state).toBe("done");
		return [...calls].sort();
	};
	const waiting = async () =>
		(await call("GET", `/projects/${projectId}/credentials-on-the-web`)).body;
	return { m, call, read, waiting, projectId };
}

describe("credentials on the web, through the API (D74)", () => {
	it("shows that nothing is chosen, and takes a mode from the three and no other", async () => {
		const { m, call } = await serve([]);
		const view = {
			mode: null,
			builtIn: [ADOBE],
			hosts: [],
			left: [],
		};
		expect((await call("GET", "/machine")).body).toEqual({
			person: null,
			credentialsOnTheWeb: view,
		});
		for (const fields of [
			{ mode: "always" },
			{ mode: null },
			{},
			{ mode: "any", hosts: ["example.org"] },
		])
			expect(
				(await call("PUT", "/machine/credentials-on-the-web", fields)).status,
				JSON.stringify(fields),
			).toBe(400);
		expect(readSettings(m.settingsPath).credentialsOnTheWeb).toBeUndefined();
		const set = await call("PUT", "/machine/credentials-on-the-web", {
			mode: "listed",
		});
		expect(set.status).toBe(200);
		expect(set.body).toEqual({
			credentialsOnTheWeb: { ...view, mode: "listed" },
		});
		expect(readSettings(m.settingsPath).credentialsOnTheWeb).toEqual({
			mode: "listed",
		});
		// Setting your name answers with the same picture of this machine.
		expect(
			(await call("PATCH", "/machine", { person: "A. Person" })).body,
		).toEqual({
			person: "A. Person",
			credentialsOnTheWeb: { ...view, mode: "listed" },
		});
	});

	it("puts a host on the list, leaves it or forgets it, and takes nothing that is not a host name", async () => {
		const { m, call } = await serve([]);
		const hosts = (fields: unknown) =>
			call("POST", "/machine/credentials-on-the-web/hosts", fields);
		for (const fields of [
			{ host: "localhost", decision: "allow" },
			{ host: "10.0.0.1", decision: "allow" },
			{ host: "http://example.org/x", decision: "allow" },
			{ host: "__proto__", decision: "allow" },
			{ host: 5, decision: "allow" },
			{ host: `${"a".repeat(300)}.example.org`, decision: "allow" },
			{ host: OTHER, decision: "trust" },
			{ host: OTHER },
			{ host: OTHER, decision: "allow", mode: "any" },
		])
			expect((await hosts(fields)).status, JSON.stringify(fields)).toBe(400);
		expect(readSettings(m.settingsPath).credentialsOnTheWeb).toBeUndefined();

		const allowed = await hosts({
			host: `https://${OTHER.toUpperCase()}/m/1`,
			decision: "allow",
		});
		expect(allowed.body).toEqual({
			host: OTHER,
			credentialsOnTheWeb: {
				mode: null,
				builtIn: [ADOBE],
				hosts: [OTHER],
				left: [],
			},
		});
		expect(
			(await hosts({ host: OTHER, decision: "leave" })).body
				.credentialsOnTheWeb,
		).toMatchObject({ hosts: [], left: [OTHER] });
		expect(
			(await hosts({ host: OTHER, decision: "forget" })).body
				.credentialsOnTheWeb,
		).toMatchObject({ hosts: [], left: [] });
	});

	it("says what a project is waiting on, host by host, and reads the files once a host is allowed", async () => {
		const { call, read, waiting } = await serve([
			`${ADOBE}.1.mp4`,
			`${ADOBE}.2.mp4`,
			`${OTHER}.1.mp4`,
			"plain.wav",
		]);
		expect((await waiting()).waiting).toEqual([]);

		// Read with nothing chosen: nothing fetched, and both hosts wait on a choice.
		expect(await read()).toHaveLength(4);
		const row = (
			host: string,
			files: number,
			state: string,
			outcome: string,
		) => ({
			host,
			address: null,
			files,
			state,
			outcome,
			detail: null,
		});
		expect(await waiting()).toEqual({
			credentialsOnTheWeb: {
				mode: null,
				builtIn: [ADOBE],
				hosts: [],
				left: [],
			},
			waiting: [
				row(ADOBE, 2, "choose", "not-chosen"),
				row(OTHER, 1, "choose", "not-chosen"),
			],
		});

		// "Listed hosts only": the built-in host can be read now, the other is asked about.
		await call("PUT", "/machine/credentials-on-the-web", { mode: "listed" });
		expect((await waiting()).waiting).toEqual([
			row(ADOBE, 2, "read", "not-chosen"),
			row(OTHER, 1, "ask", "not-chosen"),
		]);
		expect(await read()).toEqual([`${ADOBE}.1.mp4`, `${ADOBE}.2.mp4`]);
		expect((await waiting()).waiting).toEqual([
			row(OTHER, 1, "ask", "not-chosen"),
		]);

		// Left: said so, and not read.
		await call("POST", "/machine/credentials-on-the-web/hosts", {
			host: OTHER,
			decision: "leave",
		});
		expect((await waiting()).waiting).toEqual([
			row(OTHER, 1, "left", "not-chosen"),
		]);
		expect(await read()).toEqual([]);

		// Allowed after all: read, and nothing waits.
		await call("POST", "/machine/credentials-on-the-web/hosts", {
			host: OTHER,
			decision: "allow",
		});
		expect((await waiting()).waiting).toEqual([
			row(OTHER, 1, "read", "not-chosen"),
		]);
		expect(await read()).toEqual([`${OTHER}.1.mp4`]);
		expect((await waiting()).waiting).toEqual([]);
	});

	it("does not narrow the setting on a machine that signs with c2patool, which keeps to none", async () => {
		const { m, call } = await serve([]);
		updateSettings(m.settingsPath, (s) => {
			s.credentialsOnTheWeb = { mode: "any" };
			s.signingEngine = "c2patool";
		});
		const r = await call("PUT", "/machine/credentials-on-the-web", {
			mode: "listed",
		});
		expect(r.status).toBe(409);
		expect(r.body.error).toMatch(/c2patool.*settings signing-engine library/);
		expect(readSettings(m.settingsPath).credentialsOnTheWeb?.mode).toBe("any");
	});

	it("answers for a project this machine does not know as for any other route", async () => {
		const { call } = await serve([]);
		expect(
			(
				await call(
					"GET",
					"/projects/11111111-1111-4111-8111-111111111111/credentials-on-the-web",
				)
			).status,
		).toBe(404);
	});
});
