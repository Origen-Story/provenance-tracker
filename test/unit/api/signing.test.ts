// Signing, the public export and previews through the catalog API, over real
// HTTP. A stand-in engine signs (a copy of the file), so no c2patool runs; the
// certificate is a throwaway one made in the test's temp folder.

import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	saveStatement,
	writeTimeline,
} from "@provenancetracker/core/catalog/timelines.ts";
import type { Machine } from "@provenancetracker/core-node/machine.ts";
import {
	createProject,
	openProject,
} from "@provenancetracker/core-node/project.ts";
import { addRoot } from "@provenancetracker/core-node/roots.ts";
import { scanProject } from "@provenancetracker/core-node/scan.ts";
import { updateSettings } from "@provenancetracker/core-node/settings.ts";
import type { SigningEngine } from "@provenancetracker/core-node/sign/sign-output.ts";
import { TOOL } from "@provenancetracker/core-node/tool.ts";
import { devCertificate, haveOpenssl } from "../helpers/cert.ts";
import { createApp } from "../../../src/server/app.ts";
import { JobRunner } from "../../../src/server/api/jobs.ts";

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

const stub: SigningEngine = {
	name: "stub",
	version: "1.0",
	readEmbedded: async () => null,
	sign: async ({ inputPath, outputPath }) => {
		copyFileSync(inputPath, outputPath);
		writeFileSync(
			outputPath,
			Buffer.concat([readFileSync(inputPath), Buffer.from(" signed")]),
		);
		return { report: null };
	},
};

async function world() {
	const dir = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), "pt-sign-api-")),
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
	writeFileSync(path.join(media, "film.mp4"), "the cut");
	writeFileSync(path.join(media, "take.wav"), "a take");
	writeFileSync(path.join(media, "notes.txt"), "words");
	const { projectId } = createProject(folder, { name: "Demo", machine });
	updateSettings(machine.settingsPath, (s) => {
		s.person = "Settings Person";
	});
	const p = openProject(folder, { machine });
	let film: { id: number; sha256: string };
	let take: { id: number; sha256: string };
	try {
		addRoot(p, machine, {
			name: "media",
			folder: media,
			actor: { kind: "person", name: "Settings Person" },
		});
		await scanProject(p, machine);
		const byPath = (n: string) =>
			p.db
				.prepare(
					"SELECT c.asset_id AS id, c.sha256 FROM contents c JOIN locations l ON l.content_sha256 = c.sha256 WHERE l.path = ?",
				)
				.get(n) as { id: number; sha256: string };
		film = byPath("film.mp4");
		take = byPath("take.wav");
		writeTimeline(
			p.db,
			{
				outputAssetId: film.id,
				contentSha256: film.sha256,
				format: "xmeml",
				formatVersion: "4",
				fileName: "cut.xml",
				fileSha256: "1".repeat(64),
				sequence: {
					name: "Cut",
					timebase: 25,
					ntsc: false,
					fps: 25,
					durationFrames: 25,
					width: 2,
					height: 2,
				},
				notes: [],
				segments: [
					{
						clipId: "a1",
						name: "take.wav",
						trackKind: "audio",
						trackIndex: 1,
						enabled: true,
						startFrame: 0,
						endFrame: 25,
						inFrame: 0,
						outFrame: 25,
						sourceKind: "file",
						sourceKey: "f1",
						sourceName: "take.wav",
						sourcePath: "",
						matchedAssetRef: String(take.id),
						matchMethod: "path",
						matchConfidence: 1,
					},
				],
			},
			{ tool: TOOL },
		);
		saveStatement(p.db, film.id, { text: "One take.", author: "A. Maker" }, {});
	} finally {
		p.db.close();
	}
	const jobs = new JobRunner();
	const server = createApp({
		env: {},
		machine,
		catalog: { jobs, signingEngine: async () => stub },
	}).listen(0, "127.0.0.1");
	servers.push(server);
	await new Promise((r) => server.once("listening", r));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${projectId}`;
	const call = async (
		method: string,
		url: string,
		body?: unknown,
		headers: Record<string, string> = {},
	) => {
		const res = await fetch(base + url, {
			method,
			headers: {
				...(body ? { "content-type": "application/json" } : {}),
				...headers,
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		return res;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely; each test says what it expects
	const json = async (r: Response) => (await r.json()) as Record<string, any>;
	return { dir, media, film, take, jobs, call, json };
}

describe.skipIf(!haveOpenssl)("signing through the API", () => {
	it("sets up signing without ever sending a path back, signs an output as a job, and gives its public export", async () => {
		const w = await world();
		expect(await w.json(await w.call("GET", "/signing"))).toMatchObject({
			configured: false,
		});
		const cert = devCertificate(w.dir)!;
		const set = await w.call("PUT", "/signing", {
			fields: { certificate: cert.certificate, private_key: cert.privateKey },
		});
		const setText = await set.text();
		expect(set.status).toBe(200);
		expect(setText).not.toContain(cert.privateKey.replaceAll("\\", "\\\\"));
		expect(setText).not.toContain(cert.certificate.replaceAll("\\", "\\\\"));
		expect(JSON.parse(setText)).toMatchObject({
			configured: true,
			problem: null,
			certificate: { fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
		});

		const started = await w.json(
			await w.call("POST", `/assets/${w.film.id}/sign`),
		);
		const job = await w.jobs.settled(started.job.id);
		expect(job).toMatchObject({
			state: "done",
			kind: "sign",
			result: { version: 1, root: "media", path: "film.signed.v1.mp4" },
		});
		const signatureId = (job!.result as { signatureId: number }).signatureId;

		const exp = await w.call("GET", `/signatures/${signatureId}/public-export`);
		expect(exp.headers.get("content-disposition")).toBe(
			'attachment; filename="film.signed.v1.provenance.json"',
		);
		expect(await w.json(exp)).toMatchObject({
			statement: { text: "One take.", author: "A. Maker" },
			ingredients: [{ fileName: "take.wav" }],
			signedFile: { version: 1, fileName: "film.signed.v1.mp4" },
		});
		expect((await w.call("GET", "/signatures/99/public-export")).status).toBe(
			404,
		);

		// Where the signed copy is published (D56): https only, named fields only.
		const where = `/signatures/${signatureId}/publication`;
		const published = await w.call("PUT", where, {
			fields: {
				file_url: "https://media.example.org/film.signed.v1.mp4",
				page_url: "https://example.org/films/demo",
			},
		});
		expect(published.status).toBe(200);
		const body = await w.json(published);
		expect(body.publication).toEqual({
			fileUrl: "https://media.example.org/film.signed.v1.mp4",
			pageUrl: "https://example.org/films/demo",
		});
		expect(
			body.asset.signatures.find((s: { id: number }) => s.id === signatureId)
				.publication,
		).toEqual(body.publication);
		for (const [fields, status, message] of [
			[{ file_url: "http://media.example.org/film.mp4" }, 400, /https:\/\//],
			[{ withheld: [] }, 400, /there is no withheld/],
			[{ file_url: "", signature_id: 2 }, 400, /there is no signature_id/],
		] as const) {
			const r = await w.call("PUT", where, { fields });
			expect(r.status, JSON.stringify(fields)).toBe(status);
			expect((await w.json(r)).error).toMatch(message);
		}
		expect(
			(
				await w.call("PUT", "/signatures/99/publication", {
					fields: { file_url: "https://example.org/a.mp4" },
				})
			).status,
		).toBe(404);

		expect((await w.json(await w.call("DELETE", "/signing"))).configured).toBe(
			false,
		);
	});

	it("sets up your identity apart from signing, without ever sending a path back, and forgets it (D55)", async () => {
		const w = await world();
		expect(await w.json(await w.call("GET", "/identity"))).toMatchObject({
			configured: false,
		});
		const id = devCertificate(w.dir, "Test Person")!;
		const set = await w.call("PUT", "/identity", {
			fields: { certificate: id.certificate, private_key: id.privateKey },
		});
		const setText = await set.text();
		expect(set.status).toBe(200);
		expect(setText).not.toContain(id.privateKey.replaceAll("\\", "\\\\"));
		expect(setText).not.toContain(id.certificate.replaceAll("\\", "\\\\"));
		expect(JSON.parse(setText)).toMatchObject({
			configured: true,
			problem: null,
			certificate: { commonName: "Test Person" },
		});
		// Signing is a separate pair, still not set up.
		expect(await w.json(await w.call("GET", "/signing"))).toMatchObject({
			configured: false,
		});
		expect(
			(
				await w.call("PUT", "/identity", {
					fields: { certificate: id.certificate },
				})
			).status,
		).toBe(400);
		expect((await w.json(await w.call("DELETE", "/identity"))).configured).toBe(
			false,
		);
	});

	it("records a refusal as the job's error, in words", async () => {
		const w = await world();
		const started = await w.json(
			await w.call("POST", `/assets/${w.film.id}/sign`),
		);
		expect(await w.jobs.settled(started.job.id)).toMatchObject({
			state: "failed",
			error: expect.stringMatching(/no certificate and key on this machine/),
		});
		expect(
			(await w.call("PUT", "/signing", { fields: { certificate: "x" } }))
				.status,
		).toBe(400);
		expect(
			(
				await w.call("POST", `/assets/${w.film.id}/sign`, {
					fields: { key: "x" },
				})
			).status,
		).toBe(400);
		// Whether to time-stamp is the request's; which server is the tracker's.
		for (const fields of [
			{ timestamp_url: "http://elsewhere.example" },
			{ timestamp: "yes" },
		]) {
			const r = await w.call("POST", `/assets/${w.film.id}/sign`, { fields });
			expect(r.status).toBe(400);
		}
	});
});

describe("previews by content", () => {
	it("streams a picture, video or sound by its hash, with ranges, and nothing else", async () => {
		const w = await world();
		const whole = await w.call("GET", `/contents/${w.take.sha256}/file`);
		expect(whole.status).toBe(200);
		expect(whole.headers.get("content-type")).toMatch(/^audio\//);
		expect(await whole.text()).toBe("a take");
		const part = await w.call(
			"GET",
			`/contents/${w.take.sha256}/file`,
			undefined,
			{ range: "bytes=2-3" },
		);
		expect(part.status).toBe(206);
		expect(part.headers.get("content-range")).toBe("bytes 2-3/6");
		expect(await part.text()).toBe("ta");

		const notes = await w.call("GET", "/assets?q=notes");
		const sha = (await w.json(notes)).assets[0].file.sha256;
		expect((await w.call("GET", `/contents/${sha}/file`)).status).toBe(415);
		expect(
			(await w.call("GET", `/contents/${"0".repeat(64)}/file`)).status,
		).toBe(404);
		expect((await w.call("GET", "/contents/../../etc/file")).status).toBe(404);
	});
});
