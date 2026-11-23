import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import {
	saveStatement,
	writeTimeline,
	type TimelineSegment,
} from "@provenancetracker/core/catalog/timelines.ts";
import { publicExport } from "@provenancetracker/core/catalog/signatures.ts";
import { editRow } from "@provenancetracker/core/catalog/edit.ts";
import { c2patoolPath } from "../src/extract/c2patool.ts";
import { createProject, openProject } from "../src/project.ts";
import { addRoot } from "../src/roots.ts";
import { scanProject } from "../src/scan.ts";
import { certificateInfo } from "../src/sign/c2patool-sign.ts";
import { signAsset } from "../src/sign/sign-asset.ts";
import {
	NotReadyError,
	signOutput,
	type SigningEngine,
} from "../src/sign/sign-output.ts";
import {
	clearSigning,
	setSigning,
	signingStatus,
} from "../src/sign/signing-settings.ts";
import { TOOL } from "../src/tool.ts";
import { devCertificate, haveOpenssl } from "./helpers/cert.ts";
import { machinesForTests } from "./helpers/machine.ts";

const { machine, folder, track } = machinesForTests();
const ME = { kind: "person" as const, name: "Test Person" };

/** A one-second silent WAV and a 2x2 PNG: files c2patool can sign. */
function silentWav(file: string) {
	const data = Buffer.alloc(8000 * 2);
	const h = Buffer.alloc(44);
	h.write("RIFF", 0);
	h.writeUInt32LE(36 + data.length, 4);
	h.write("WAVEfmt ", 8);
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(1, 20);
	h.writeUInt16LE(1, 22);
	h.writeUInt32LE(8000, 24);
	h.writeUInt32LE(16000, 28);
	h.writeUInt16LE(2, 32);
	h.writeUInt16LE(16, 34);
	h.write("data", 36);
	h.writeUInt32LE(data.length, 40);
	writeFileSync(file, Buffer.concat([h, data]));
}
function tinyPng(file: string, rgb: number[]) {
	const crc = (b: Buffer) => {
		let c = ~0;
		for (const x of b) {
			c ^= x;
			for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
		}
		return ~c >>> 0;
	};
	const chunk = (t: string, d: Buffer) => {
		const l = Buffer.alloc(4);
		l.writeUInt32BE(d.length);
		const td = Buffer.concat([Buffer.from(t), d]);
		const c = Buffer.alloc(4);
		c.writeUInt32BE(crc(td));
		return Buffer.concat([l, td, c]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(2, 0);
	ihdr.writeUInt32BE(2, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const row = Buffer.from([0, ...rgb, ...rgb]);
	const idat = deflateSync(Buffer.concat([row, row]));
	writeFileSync(
		file,
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk("IHDR", ihdr),
			chunk("IDAT", idat),
			chunk("IEND", Buffer.alloc(0)),
		]),
	);
}

/** A project whose output (export.png) has a timeline placing a still and a sound, and a saved statement. */
async function world(opts: { signing?: boolean; statement?: boolean } = {}) {
	const m = machine();
	const dir = folder("w");
	const media = path.join(dir, "Demo", "media");
	mkdirSync(media, { recursive: true });
	tinyPng(path.join(media, "export.png"), [0, 0, 255]);
	tinyPng(path.join(media, "still.png"), [0, 255, 0]);
	silentWav(path.join(media, "tone.wav"));
	createProject(path.join(dir, "Demo"), { name: "Demo", machine: m });
	const p = track(openProject(path.join(dir, "Demo"), { machine: m }));
	addRoot(p, m, { name: "media", folder: media, actor: ME });
	await scanProject(p, m);
	const id = (name: string) =>
		p.db
			.prepare(
				"SELECT c.asset_id AS id, c.sha256 FROM contents c JOIN locations l ON l.content_sha256 = c.sha256 WHERE l.path = ?",
			)
			.get(name) as { id: number; sha256: string };
	const film = id("export.png");
	const seg = (over: Partial<TimelineSegment>): TimelineSegment => ({
		clipId: "c",
		name: "",
		trackKind: "video",
		trackIndex: 1,
		enabled: true,
		startFrame: 0,
		endFrame: 25,
		inFrame: 0,
		outFrame: 25,
		sourceKind: "file",
		sourceKey: null,
		sourceName: "",
		sourcePath: "",
		matchedAssetRef: null,
		matchMethod: "path",
		matchConfidence: 1,
		...over,
	});
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
				seg({
					clipId: "v1",
					name: "still.png",
					sourceKey: "f1",
					sourceName: "still.png",
					matchedAssetRef: String(id("still.png").id),
				}),
				seg({
					clipId: "a1",
					name: "tone.wav",
					trackKind: "audio",
					sourceKey: "f2",
					sourceName: "tone.wav",
					matchedAssetRef: String(id("tone.wav").id),
				}),
			],
		},
		{ tool: TOOL },
	);
	// A person has said what the sources are, as signing a source asset needs.
	for (const n of ["tone.wav", "still.png"])
		editRow(
			p.db,
			"assets",
			id(n).id,
			{ origin_class: "digitalCreation" },
			{ actor: ME },
		);
	const statementId =
		opts.statement === false
			? null
			: saveStatement(
					p.db,
					film.id,
					{ text: "A still and a tone.", author: "A. Maker" },
					{},
				);
	const cert = opts.signing === false ? null : devCertificate(dir);
	if (cert) await setSigning(m, p.projectId, cert);
	return { m, p, dir, media, film, statementId, cert, id };
}

/** A stand-in signer: copies the file and remembers what it was asked. */
function stubEngine() {
	const calls: Array<Parameters<SigningEngine["sign"]>[0]> = [];
	const engine: SigningEngine = {
		name: "stub",
		version: "1.0",
		readEmbedded: async () => null,
		sign: async (args) => {
			calls.push(args);
			copyFileSync(args.inputPath, args.outputPath);
			writeFileSync(
				args.outputPath,
				Buffer.concat([
					readFileSync(args.inputPath),
					Buffer.from(`signed ${calls.length}`),
				]),
			);
			return { report: null };
		},
	};
	return { engine, calls };
}

describe.skipIf(!haveOpenssl)("signing settings", () => {
	it("sets the certificate and key for a project on this machine, says what signs, and forgets them", async () => {
		const w = await world({ signing: false });
		expect(await signingStatus(w.m, w.p.projectId)).toMatchObject({
			configured: false,
		});
		const cert = devCertificate(w.dir)!;
		const status = await setSigning(w.m, w.p.projectId, cert);
		expect(status).toMatchObject({
			configured: true,
			problem: null,
			certificate: {
				fingerprint: (await certificateInfo(cert.certificate)).fingerprint,
			},
		});
		expect(JSON.stringify(status)).not.toContain(cert.privateKey);
		expect(JSON.stringify(status)).not.toContain(cert.certificate);

		await expect(
			setSigning(w.m, w.p.projectId, {
				certificate: "relative.pem",
				privateKey: cert.privateKey,
			}),
		).rejects.toThrow(/full path/);
		await expect(
			setSigning(w.m, w.p.projectId, {
				certificate: cert.certificate,
				privateKey: path.join(w.dir, "none.pem"),
			}),
		).rejects.toThrow(/no private key file/);
		await expect(
			setSigning(w.m, w.p.projectId, {
				certificate: cert.certificate,
				privateKey: cert.certificate,
			}),
		).rejects.toThrow(/same file/);
		await expect(
			setSigning(w.m, w.p.projectId, {
				certificate: path.join(w.media, "tone.wav"),
				privateKey: cert.privateKey,
			}),
		).rejects.toThrow(/does not read as a certificate/);

		rmSync(cert.privateKey);
		expect((await signingStatus(w.m, w.p.projectId)).problem).toMatch(
			/private key file is not there/,
		);
		clearSigning(w.m, w.p.projectId);
		expect((await signingStatus(w.m, w.p.projectId)).configured).toBe(false);
	});
});

describe.skipIf(!haveOpenssl)("signOutput", () => {
	it("signs a new copy beside the output's file and records it as a version of the output", async () => {
		const w = await world();
		const { engine, calls } = stubEngine();
		const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
		expect(r).toMatchObject({
			version: 1,
			root: "media",
			path: "export.signed.v1.png",
		});
		expect(existsSync(path.join(w.media, "export.signed.v1.png"))).toBe(true);
		// What the engine was asked: the output as the parent, then each source placed.
		expect(
			calls[0].ingredients.map((i) => [i.label, i.relationship, i.title]),
		).toEqual([
			["ing-parent", "parentOf", "export.png"],
			["ing-1", "componentOf", "still.png"],
			["ing-2", "componentOf", "tone.wav"],
		]);
		expect(calls[0].definition).toMatchObject({
			title: "export.png",
			claim_generator_info: [{ name: "provenance-tracker" }],
		});
		const s = w.p.db
			.prepare("SELECT * FROM signatures WHERE id = ?")
			.get(r.signatureId) as Record<string, unknown>;
		expect(s).toMatchObject({
			asset_id: w.film.id,
			kind: "output",
			version: 1,
			source_sha256: w.film.sha256,
			engine: "stub",
			engine_version: "1.0",
			statement_id: w.statementId,
			certificate_sha256: (await certificateInfo(w.cert!.certificate))
				.fingerprint,
		});
		expect(JSON.parse(s.statement as string)).toMatchObject({
			text: "A still and a tone.",
			author: "A. Maker",
			ingredients: [{ title: "still.png" }, { title: "tone.wav" }],
		});
		expect(
			w.p.db
				.prepare("SELECT asset_id FROM contents WHERE sha256 = ?")
				.get(s.signed_sha256 as string),
		).toEqual({ asset_id: w.film.id });
		// No key path anywhere in what was recorded.
		const everything =
			JSON.stringify(w.p.db.prepare("SELECT * FROM signatures").all()) +
			JSON.stringify(w.p.db.prepare("SELECT * FROM runs").all());
		expect(everything).not.toContain(w.cert!.privateKey);
		expect(everything).not.toContain("private_key");
	});

	it("counts on from the catalog's versions and never replaces a file already there", async () => {
		const w = await world();
		const { engine } = stubEngine();
		await signOutput(w.p, w.m, { assetId: w.film.id, engine });
		writeFileSync(
			path.join(w.media, "export.signed.v2.png"),
			"someone else's file",
		);
		const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
		expect(r).toMatchObject({ version: 3, path: "export.signed.v3.png" });
		expect(
			readFileSync(path.join(w.media, "export.signed.v2.png"), "utf8"),
		).toBe("someone else's file");
	});

	it("refuses, writing nothing, without signing set up, a statement, a source file, or with a changed file", async () => {
		const unset = await world({ signing: false });
		await expect(
			signOutput(unset.p, unset.m, {
				assetId: unset.film.id,
				engine: stubEngine().engine,
			}),
		).rejects.toThrow(NotReadyError);

		const w = await world();
		const { engine } = stubEngine();
		rmSync(path.join(w.media, "still.png"));
		await expect(
			signOutput(w.p, w.m, { assetId: w.film.id, engine }),
		).rejects.toThrow(/not on this machine, and c2patool reads each one/);
		tinyPng(path.join(w.media, "still.png"), [0, 255, 0]);
		writeFileSync(path.join(w.media, "export.png"), "edited since the scan");
		await expect(
			signOutput(w.p, w.m, { assetId: w.film.id, engine }),
		).rejects.toThrow(/changed since it was scanned/);
		expect(
			w.p.db.prepare("SELECT count(*) AS n FROM signatures").get(),
		).toEqual({ n: 0 });

		const noStatement = await world({ statement: false });
		await expect(
			signOutput(noStatement.p, noStatement.m, {
				assetId: noStatement.film.id,
				engine,
			}),
		).rejects.toThrow(/creator statement/);
	});
});

const haveC2patool = (() => {
	try {
		return (
			spawnSync(c2patoolPath({}, process.platform), ["--version"], {
				encoding: "utf8",
			}).status === 0
		);
	} catch {
		return false;
	}
})();

describe.skipIf(!haveOpenssl || !haveC2patool)(
	"signOutput with c2patool",
	() => {
		it("signs for real with a throwaway certificate, and the public export builds from the record", async () => {
			const w = await world();
			const r = await signOutput(w.p, w.m, { assetId: w.film.id });
			expect(existsSync(path.join(w.media, r.path))).toBe(true);
			const s = w.p.db
				.prepare(
					"SELECT engine, engine_version, report, signer_name FROM signatures WHERE id = ?",
				)
				.get(r.signatureId) as Record<string, unknown>;
			expect(s.engine).toBe("c2patool");
			expect(s.engine_version).not.toBe("");
			expect(JSON.parse(s.report as string)).toHaveProperty("active_manifest");
			const { data } = publicExport(w.p.db, r.signatureId, {
				generatedAt: "2026-11-23T00:00:00.000Z",
				generator: { name: "provenance-tracker", version: "0" },
			});
			expect(data).toMatchObject({
				ingredients: [{ fileName: "still.png" }, { fileName: "tone.wav" }],
				signedFile: { version: 1 },
			});
		}, 120000);
	},
);

describe.skipIf(!haveOpenssl)("signAsset", () => {
	const sidecarOf = (w: Awaited<ReturnType<typeof world>>) =>
		path.join(w.media, "tone.c2pa");

	it("signs a source asset into a .c2pa sidecar beside it, recorded as a version of the asset, and a scan finds nothing new", async () => {
		const w = await world();
		const tone = w.id("tone.wav");
		const { engine, calls } = stubEngine();
		const r = await signAsset(w.p, w.m, {
			assetId: tone.id,
			engine,
			creatorName: "A. Maker",
		});
		expect(r).toMatchObject({
			version: 1,
			root: "media",
			path: "tone.c2pa",
			archived: null,
		});
		expect(calls[0]).toMatchObject({
			outputPath: sidecarOf(w),
			sidecar: true,
			definition: { title: "tone.wav" },
		});
		expect(
			readFileSync(path.join(w.media, "tone.wav")).subarray(0, 4).toString(),
		).toBe("RIFF");
		const s = w.p.db
			.prepare(
				"SELECT kind, version, source_sha256, signed_sha256, statement_id FROM signatures WHERE id = ?",
			)
			.get(r.signatureId) as Record<string, unknown>;
		expect(s).toMatchObject({
			kind: "asset",
			version: 1,
			source_sha256: tone.sha256,
			statement_id: null,
		});
		expect(
			w.p.db
				.prepare("SELECT asset_id FROM contents WHERE sha256 = ?")
				.get(s.signed_sha256 as string),
		).toEqual({ asset_id: tone.id });
		const scan = await scanProject(w.p, w.m);
		expect(scan.counts).toMatchObject({ added: 0, newAssets: 0, gone: 0 });
	});

	it("sets the earlier sidecar aside on re-signing, moving it in the catalog in the same step", async () => {
		const w = await world();
		const tone = w.id("tone.wav");
		const { engine } = stubEngine();
		const first = await signAsset(w.p, w.m, { assetId: tone.id, engine });
		const r = await signAsset(w.p, w.m, { assetId: tone.id, engine });
		expect(r).toMatchObject({
			version: 2,
			path: "tone.c2pa",
			archived: "tone.v1.c2pa",
		});
		expect(existsSync(path.join(w.media, "tone.v1.c2pa"))).toBe(true);
		const firstSha = (
			w.p.db
				.prepare("SELECT signed_sha256 FROM signatures WHERE id = ?")
				.get(first.signatureId) as { signed_sha256: string }
		).signed_sha256;
		expect(
			w.p.db
				.prepare(
					"SELECT path, gone_run_id IS NULL AS live FROM locations WHERE content_sha256 = ? ORDER BY id",
				)
				.all(firstSha),
		).toEqual([
			{ path: "tone.c2pa", live: 0 },
			{ path: "tone.v1.c2pa", live: 1 },
		]);
		expect((await scanProject(w.p, w.m)).counts).toMatchObject({
			added: 0,
			gone: 0,
			moved: 0,
		});
	});

	it("refuses a .c2pa it did not write, and a file with credentials of its own, writing nothing", async () => {
		const w = await world();
		const tone = w.id("tone.wav");
		writeFileSync(sidecarOf(w), "someone else's");
		await expect(
			signAsset(w.p, w.m, { assetId: tone.id, engine: stubEngine().engine }),
		).rejects.toThrow(/the tracker did not write it/);
		rmSync(sidecarOf(w));
		const signed = {
			...stubEngine().engine,
			readEmbedded: async () => ({ signer: "Example Camera" }),
		};
		await expect(
			signAsset(w.p, w.m, { assetId: tone.id, engine: signed }),
		).rejects.toThrow(
			/already carries its own Content Credentials \(signed by Example Camera\)/,
		);
		expect(
			w.p.db.prepare("SELECT count(*) AS n FROM signatures").get(),
		).toEqual({ n: 0 });
	});

	it("puts the earlier sidecar back when signing fails", async () => {
		const w = await world();
		const tone = w.id("tone.wav");
		await signAsset(w.p, w.m, {
			assetId: tone.id,
			engine: stubEngine().engine,
		});
		const before = readFileSync(sidecarOf(w));
		const failing = {
			...stubEngine().engine,
			sign: async () => {
				throw new Error("Signing failed: example");
			},
		};
		await expect(
			signAsset(w.p, w.m, { assetId: tone.id, engine: failing }),
		).rejects.toThrow(/example/);
		expect(readFileSync(sidecarOf(w))).toEqual(before);
		expect(existsSync(path.join(w.media, "tone.v1.c2pa"))).toBe(false);
		expect(
			w.p.db.prepare("SELECT count(*) AS n FROM signatures").get(),
		).toEqual({ n: 1 });
	});
});

describe.skipIf(!haveOpenssl || !haveC2patool)(
	"signAsset with c2patool",
	() => {
		it("writes a sidecar c2patool reads back against the file", async () => {
			const w = await world();
			const still = w.id("still.png");
			const r = await signAsset(w.p, w.m, { assetId: still.id });
			expect(r).toMatchObject({ path: "still.c2pa", version: 1 });
			const s = w.p.db
				.prepare("SELECT engine, report FROM signatures WHERE id = ?")
				.get(r.signatureId) as Record<string, unknown>;
			expect(s.engine).toBe("c2patool");
			expect(JSON.parse(s.report as string)).toHaveProperty("active_manifest");
		}, 120000);
	},
);
