import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import {
	saveStatement,
	writeTimeline,
	type TimelineSegment,
} from "@provenancetracker/core/catalog/timelines.ts";
import { publicExport } from "@provenancetracker/core/catalog/signatures.ts";
import { validate } from "../../core/test/helpers/json-schema-lite.js";
import { editRow } from "@provenancetracker/core/catalog/edit.ts";
import { setThumbnail } from "@provenancetracker/core/catalog/edits.ts";
import { c2patoolPath } from "../src/extract/c2patool.ts";
import { createProject, openProject } from "../src/project.ts";
import { addRoot } from "../src/roots.ts";
import { scanProject } from "../src/scan.ts";
import { extractProject } from "../src/extract.ts";
import { certificateInfo } from "../src/sign/certificates.ts";
import { signingEngineFor } from "../src/sign/engines/index.ts";
import {
	loadLibrary,
	PINNED_BINARY,
	readStore,
	type LoadedLibrary,
} from "../src/extract/c2pa-library.ts";
import { interpretReport } from "@provenancetracker/core/manifest/verify.js";
import { makeObservation } from "@provenancetracker/core/extraction/observation.ts";
import { readIdentity } from "@provenancetracker/core/manifest/identity.ts";
import { signAsset } from "../src/sign/sign-asset.ts";
import { signWithLibrary } from "../src/sign/engines/library.ts";
import { keyFilesHolder } from "../src/sign/holders/key-files.ts";
import {
	NotReadyError,
	previewOutputStatement,
	sameName,
	signOutput,
	type SigningEngine,
} from "../src/sign/sign-output.ts";
import {
	clearSigning,
	setIdentity,
	setSigning,
	signingStatus,
} from "../src/sign/signing-settings.ts";
import { TOOL } from "../src/tool.ts";
import {
	DEV_CERT_NAME,
	devCertificate,
	haveOpenssl,
	OPENSSL,
} from "./helpers/cert.ts";
import { memoryHolder } from "./helpers/holder.ts";
import { machinesForTests } from "./helpers/machine.ts";
import {
	libraryReaders,
	noCredentials,
	soundReport,
} from "./helpers/readers.ts";

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
	// Read, as a project's files are before anything is signed: none of these
	// carries credentials.
	await extractProject(p, m, { readers: [noCredentials] });
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
	/** The cut's timeline, as an import writes it: again for a re-rendered cut. */
	const cutTimeline = (contentSha256: string) =>
		writeTimeline(
			p.db,
			{
				outputAssetId: film.id,
				contentSha256,
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
	cutTimeline(film.sha256);
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
	return { m, p, dir, media, film, statementId, cert, id, cutTimeline };
}

type World = Awaited<ReturnType<typeof world>>;

/** A manifest as a camera app or a generator signs one, naming who made the file. */
const madeBy = (title: string, author: string) => ({
	claim_generator_info: [{ name: "example-camera-app", version: "1" }],
	title,
	assertions: [
		{
			label: "c2pa.actions.v2",
			data: {
				actions: [
					{
						action: "c2pa.created",
						digitalSourceType:
							"http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation",
					},
				],
			},
		},
		{
			label: "stds.schema-org.CreativeWork",
			data: {
				"@context": "https://schema.org",
				"@type": "CreativeWork",
				author: [{ "@type": "Person", name: author }],
			},
		},
	],
});

/**
 * Give a file in the media folder credentials of its own, naming its author,
 * in the file itself or in a .c2pa sidecar beside it. Nothing is scanned:
 * the catalog still knows the file as it was.
 */
async function giveCredentials(
	w: World,
	loaded: LoadedLibrary,
	name: string,
	author: string,
	opts: {
		sidecar?: boolean;
		/** More that its credentials say, beside who made it. */
		assertions?: Array<{ label: string; data: unknown }>;
	} = {},
) {
	const file = path.join(w.media, name);
	const definition = madeBy(name, author);
	const made = path.join(
		mkdtempSync(path.join(w.dir, "made-")),
		opts.sidecar ? `${path.parse(name).name}.c2pa` : name,
	);
	await signWithLibrary(loaded, {
		inputPath: file,
		outputPath: made,
		definition: {
			...definition,
			assertions: [...definition.assertions, ...(opts.assertions ?? [])],
		},
		ingredients: [],
		holder: await keyFilesHolder({
			certificatePath: w.cert!.certificate,
			privateKeyPath: w.cert!.privateKey,
		}),
		sidecar: opts.sidecar,
	});
	copyFileSync(
		made,
		opts.sidecar ? path.join(w.media, path.basename(made)) : file,
	);
}

/** Scan, and read every file with the C2PA library, as a project's files are. */
async function scanAndRead(w: World, loaded: LoadedLibrary) {
	await scanProject(w.p, w.m);
	await extractProject(w.p, w.m, { readers: libraryReaders(loaded) });
}

/** The content the catalog has live at a path now. */
const liveAt = (w: World, name: string) =>
	w.p.db
		.prepare(
			`SELECT c.asset_id AS id, c.sha256 FROM contents c JOIN locations l ON l.content_sha256 = c.sha256
			 WHERE l.path = ? AND l.gone_run_id IS NULL`,
		)
		.get(name) as { id: number; sha256: string };

type ReadBack = {
	active_manifest: string;
	manifests: Record<
		string,
		{ assertions: Array<{ label: string; data: unknown }> }
	>;
};

/** A poster image found by a scan and picked as the edit's thumbnail (D52). */
async function withPoster(w: Awaited<ReturnType<typeof world>>) {
	tinyPng(path.join(w.media, "poster.png"), [255, 0, 0]);
	await scanProject(w.p, w.m);
	const poster = w.id("poster.png");
	setThumbnail(w.p.db, w.film.id, poster.id, { actor: ME, tool: TOOL });
	return poster;
}

/** The time range of each placed action in a definition. */
function placements(definition: Record<string, unknown>) {
	const assertions = definition.assertions as Array<{
		label: string;
		data: {
			actions: Array<{
				action: string;
				changes?: Array<{ region?: Array<{ time?: unknown }> }>;
			}>;
		};
	}>;
	return assertions
		.find((a) => a.label.startsWith("c2pa.actions"))!
		.data.actions.filter((a) => a.action === "c2pa.placed")
		.map((a) => a.changes?.[0]?.region?.[0]?.time);
}

/** A stand-in signer: copies the file and remembers what it was asked. */
function stubEngine() {
	const calls: Array<Parameters<SigningEngine["sign"]>[0]> = [];
	const engine: SigningEngine = {
		name: "stub",
		version: "1.0",
		readEmbedded: async () => null,
		// A stand-in reads every source as carrying no credentials.
		read: async () =>
			makeObservation({ kind: "c2pa", extractor: "stub", status: "absent" }),
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
			return { report: soundReport() };
		},
	};
	return { engine, calls };
}

describe("the development certificate script, asked for an identity", () => {
	it("refuses --name without a folder, so an identity never lands in certs/ beside the signing pair", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pt-devcert-name-"));
		try {
			const r = spawnSync(
				process.execPath,
				[
					path.resolve(
						import.meta.dirname,
						"..",
						"..",
						"..",
						"scripts",
						"generate-dev-cert.mjs",
					),
					"--name",
					"Test Person",
				],
				// certs/ would be resolved against this folder.
				{ cwd: dir, encoding: "utf8" },
			);
			expect(r.status).toBe(1);
			expect(r.stderr).toContain("say which folder it goes in");
			expect(existsSync(path.join(dir, "certs"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe.skipIf(!haveOpenssl)("the development certificate script", () => {
	it("names the authority key identifier, which c2patool requires and macOS's openssl does not add unasked", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pt-devcert-"));
		try {
			const cert = devCertificate(dir)!;
			const text = spawnSync(
				OPENSSL!,
				["x509", "-in", cert.certificate, "-noout", "-text"],
				{ encoding: "utf8" },
			).stdout;
			expect(text).toContain("Authority Key Identifier");
			expect(text).toContain("E-mail Protection");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe.skipIf(!haveOpenssl)(
	"the names the development certificate script gives (D67)",
	() => {
		const subject = (certificate: string) =>
			spawnSync(
				OPENSSL!,
				[
					"x509",
					"-in",
					certificate,
					"-noout",
					"-subject",
					"-issuer",
					"-nameopt",
					"RFC2253",
				],
				{ encoding: "utf8" },
			).stdout;

		it("gives each run a name of its own, so two people's default certificates never read the same", async () => {
			const dir = mkdtempSync(path.join(tmpdir(), "pt-devcert-names-"));
			try {
				const one = devCertificate(path.join(dir, "one"))!;
				const two = devCertificate(path.join(dir, "two"))!;
				const [a, b] = await Promise.all(
					[one, two].map((c) => certificateInfo(c.certificate)),
				);
				expect(a.commonName).toMatch(DEV_CERT_NAME);
				expect(b.commonName).toMatch(DEV_CERT_NAME);
				expect(a.commonName).not.toBe(b.commonName);
				// The authority that issued each is named for the same run.
				expect(a.issuer).toBe(
					`Provenance Tracker development root ${a.commonName.split(" ").pop()}`,
				);
				// Neither names a person or an organisation: the defaults are the
				// same for everyone who runs the tool.
				expect(subject(one.certificate)).toMatch(
					/subject=O=Unverified\\, self-issued [0-9a-f]{8},CN=Provenance Tracker development certificate [0-9a-f]{8}/,
				);
				expect(subject(one.certificate)).not.toContain("Origen");
				expect(a.issuer).not.toBe(b.issuer);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("puts an identity nobody checked under no organisation but the person's own", () => {
			const dir = mkdtempSync(path.join(tmpdir(), "pt-devcert-names-"));
			try {
				const script = path.resolve(
					import.meta.dirname,
					"..",
					"..",
					"..",
					"scripts",
					"generate-dev-cert.mjs",
				);
				const make = (folder: string, ...args: string[]) => {
					const r = spawnSync(
						process.execPath,
						[script, path.join(dir, folder), "--name", "Jane Example", ...args],
						{ encoding: "utf8" },
					);
					expect(r.status, r.stderr).toBe(0);
					return subject(path.join(dir, folder, "c2pa-dev-cert.pem"));
				};
				// No organisation given: it says what it is, and never names one
				// the person did not.
				const bare = make("bare");
				expect(bare).toMatch(
					/subject=O=Unverified\\, self-issued [0-9a-f]{8},CN=Jane Example/,
				);
				expect(bare).not.toMatch(/subject=.*Origen Story/);
				// Their own organisation is their own claim.
				expect(make("own", "--org", "Example Studio")).toMatch(
					/subject=O=Example Studio,CN=Jane Example/,
				);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	},
);

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

describe("previewOutputStatement", () => {
	const fixedNow = () => "2026-01-02T03:04:05.000Z";
	it("builds the statement signing would, and writes nothing", async () => {
		const w = await world({ signing: false });
		const before = JSON.stringify([
			w.p.db.prepare("SELECT * FROM timelines").all(),
			w.p.db.prepare("SELECT count(*) AS n FROM history").get(),
			w.p.db.prepare("SELECT count(*) AS n FROM runs").get(),
		]);
		const r = previewOutputStatement(w.p, w.m, {
			assetId: w.film.id,
			now: fixedNow,
		});
		expect(r.blockers).toEqual([]);
		expect(r.ingredientAssetIds).toEqual([
			w.id("still.png").id,
			w.id("tone.wav").id,
		]);
		expect(r.statement).toMatchObject({
			statedAt: "2026-01-02T03:04:05.000Z",
			text: "A still and a tone.",
			author: "A. Maker",
			output: { title: "export.png" },
			ingredients: [
				{ ref: "ing-1", title: "still.png" },
				{ ref: "ing-2", title: "tone.wav" },
			],
			unresolved: [],
		});
		expect(
			JSON.stringify([
				w.p.db.prepare("SELECT * FROM timelines").all(),
				w.p.db.prepare("SELECT count(*) AS n FROM history").get(),
				w.p.db.prepare("SELECT count(*) AS n FROM runs").get(),
			]),
		).toBe(before);
	});

	it("says what stops signing: no statement, a placed file not here", async () => {
		const w = await world({ signing: false, statement: false });
		rmSync(path.join(w.media, "tone.wav"));
		const r = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
		expect(r.blockers).toEqual([
			"Write and save the creator statement before signing.",
			expect.stringMatching(
				/files the timeline places are not on this machine/,
			),
		]);
		// The missing file is still listed, named from where it was last seen.
		expect(r.statement).toMatchObject({
			text: "",
			ingredients: [{ title: "still.png" }, { title: "tone.wav" }],
		});
	});

	it("needs a timeline, and is only for an output", async () => {
		const w = await world({ signing: false });
		w.p.db.prepare("DELETE FROM timeline_clips").run();
		expect(() =>
			previewOutputStatement(w.p, w.m, { assetId: w.id("still.png").id }),
		).toThrow(NotReadyError);
	});
});

describe.skipIf(!haveOpenssl)("previewOutputStatement and signOutput", () => {
	it("preview and signing build the same statement", async () => {
		const w = await world();
		const now = () => "2026-01-02T03:04:05.000Z";
		const preview = previewOutputStatement(w.p, w.m, {
			assetId: w.film.id,
			now,
		});
		const { engine } = stubEngine();
		const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine, now });
		const signed = w.p.db
			.prepare("SELECT statement FROM signatures WHERE id = ?")
			.get(r.signatureId) as { statement: string };
		expect(JSON.parse(signed.statement)).toEqual(preview.statement);
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

	it("places each source over the stretch of the edit it plays in (D17)", async () => {
		const w = await world();
		const { engine, calls } = stubEngine();
		await signOutput(w.p, w.m, { assetId: w.film.id, engine });
		// The still and the tone each play over the whole one-second cut.
		expect(placements(calls[0].definition)).toEqual([
			{ type: "npt", start: "0", end: "1" },
			{ type: "npt", start: "0", end: "1" },
		]);
		expect(calls[0].resources).toEqual([]);
		expect(calls[0].definition.thumbnail).toBeUndefined();
	});

	it("carries the picked thumbnail, named by its hash, and refuses when its bytes changed (D52)", async () => {
		const w = await world();
		const poster = await withPoster(w);
		expect(
			previewOutputStatement(w.p, w.m, { assetId: w.film.id }),
		).toMatchObject({ blockers: [], thumbnailAssetId: poster.id });
		const { engine, calls } = stubEngine();
		const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
		const thumbnail = {
			format: "image/png",
			identifier: `${poster.sha256}.png`,
		};
		expect(calls[0].definition.thumbnail).toEqual(thumbnail);
		expect(calls[0].resources).toEqual([
			{
				identifier: thumbnail.identifier,
				filePath: path.join(w.media, "poster.png"),
			},
		]);
		// Recorded by hash, never by path.
		const stored = w.p.db
			.prepare("SELECT definition FROM signatures WHERE id = ?")
			.get(r.signatureId) as { definition: string };
		expect(JSON.parse(stored.definition).thumbnail).toEqual(thumbnail);
		expect(stored.definition).not.toContain("poster.png");

		tinyPng(path.join(w.media, "poster.png"), [0, 0, 0]);
		await expect(
			signOutput(w.p, w.m, { assetId: w.film.id, engine }),
		).rejects.toThrow(/thumbnail image has changed since it was scanned/);
	});

	it("says when the thumbnail cannot be used here: not on this machine, or not an image", async () => {
		const w = await world();
		await withPoster(w);
		rmSync(path.join(w.media, "poster.png"));
		expect(
			previewOutputStatement(w.p, w.m, { assetId: w.film.id }).blockers,
		).toEqual([
			expect.stringMatching(/thumbnail image is not on this machine/),
		]);
		await expect(
			signOutput(w.p, w.m, { assetId: w.film.id, engine: stubEngine().engine }),
		).rejects.toThrow(/thumbnail image is not on this machine/);

		// A file named like a PNG that is not one.
		writeFileSync(path.join(w.media, "poster.png"), "not an image");
		await scanProject(w.p, w.m);
		expect(
			previewOutputStatement(w.p, w.m, { assetId: w.film.id }).blockers,
		).toEqual([expect.stringMatching(/not a JPEG or PNG/)]);
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
		).rejects.toThrow(/not on this machine, and signing reads each one/);
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

const haveLibrary = existsSync(PINNED_BINARY);
const ENGINES = [
	{ name: "library", recorded: "c2pa-node", ready: haveLibrary },
	{ name: "c2patool", recorded: "c2patool", ready: haveC2patool },
] as const;

/** What a reader makes of a signed file: c2patool's report, or the library's. */
async function readWith(
	reader: "library" | "c2patool",
	file: string,
	sidecar?: string,
) {
	if (reader === "c2patool")
		return JSON.parse(
			spawnSync(
				c2patoolPath({}, process.platform),
				sidecar ? [file, "--external-manifest", sidecar] : [file],
				{ encoding: "utf8" },
			).stdout,
		);
	const loaded = await loadLibrary({}, { remoteManifests: false });
	if ("unavailable" in loaded) throw new Error(loaded.unavailable);
	return readStore(loaded, file, sidecar);
}

describe.each(ENGINES)("signOutput with $name", ({ name, recorded, ready }) => {
	const other = name === "library" ? "c2patool" : "library";
	const otherReady = ENGINES.find((e) => e.name === other)!.ready;

	it.skipIf(!haveOpenssl || !ready || !otherReady)(
		`writes the time ranges and the thumbnail into the file, where ${other} finds them`,
		async () => {
			const w = await world();
			await withPoster(w);
			const engine = await signingEngineFor(w.m, name);
			const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			const report = await readWith(other, path.join(w.media, r.path));
			const active = report.manifests[report.active_manifest];
			expect(active.thumbnail).toMatchObject({ format: "image/png" });
			expect(placements(active)).toEqual([
				{ type: "npt", start: "0", end: "1" },
				{ type: "npt", start: "0", end: "1" },
			]);
			expect(interpretReport(report).status).toBe("unrecognised_issuer");
		},
		120000,
	);

	it.skipIf(!haveOpenssl || !ready)(
		"signs for real with a throwaway certificate, and the public export builds from the record and meets its published schema",
		async () => {
			const w = await world();
			const engine = await signingEngineFor(w.m, name);
			const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			expect(existsSync(path.join(w.media, r.path))).toBe(true);
			expect(r.status).toBe("unrecognised_issuer");
			const s = w.p.db
				.prepare(
					"SELECT engine, engine_version, report, signer_name FROM signatures WHERE id = ?",
				)
				.get(r.signatureId) as Record<string, unknown>;
			expect(s.engine).toBe(recorded);
			expect(s.engine_version).not.toBe("");
			expect(s.signer_name).toMatch(DEV_CERT_NAME);
			expect(JSON.parse(s.report as string)).toHaveProperty("active_manifest");
			const { data } = publicExport(w.p.db, r.signatureId, {
				generatedAt: "2026-11-23T00:00:00.000Z",
				generator: { name: "provenance-tracker", version: "0" },
			});
			expect(data).toMatchObject({
				ingredients: [{ fileName: "still.png" }, { fileName: "tone.wav" }],
				signedFile: { version: 1 },
			});
			// Built from the engine's real read-back of the signed file, as the viewer reads it.
			const schema = JSON.parse(
				readFileSync(
					path.resolve(
						import.meta.dirname,
						"..",
						"..",
						"..",
						"spec",
						"public-export.v2.schema.json",
					),
					"utf8",
				),
			);
			expect(validate(schema, data)).toEqual([]);
			// Three results, read apart (D57). A throwaway certificate, no identity.
			expect(data).toMatchObject({
				formatVersion: 2,
				file: { status: "matches", hashVerified: true },
				signer: { status: "unrecognised_issuer" },
				identity: null,
				signedFile: { url: null },
				page: { url: null },
				withheld: { fromRecord: 0, fromSignedFile: 0 },
			});
		},
		120000,
	);

	it.skipIf(!haveOpenssl || !ready)(
		name === "library"
			? "adds the creator's identity once it is set up, says so beforehand, and warns when the names differ (D55)"
			: "refuses to sign without the identity once it is set up, before anything is written (D55)",
		async () => {
			const w = await world();
			const id = devCertificate(folder("identity"), "es256", "Test Person")!;
			await setIdentity(w.m, w.p.projectId, id);
			const preview = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
			expect(preview.identity).toMatchObject({
				name: "Test Person",
				issuer: expect.stringMatching(
					/^Provenance Tracker development root [0-9a-f]{8}$/,
				),
				role: "cawg.creator",
				// The statement's author is "A. Maker".
				authorDiffers: true,
			});
			const engine = await signingEngineFor(w.m, name);
			if (name === "c2patool") {
				await expect(
					signOutput(w.p, w.m, { assetId: w.film.id, engine }),
				).rejects.toThrow(/c2patool cannot add it/);
				expect(existsSync(path.join(w.media, "export.signed.v1.png"))).toBe(
					false,
				);
				return;
			}
			expect(preview.blockers).toEqual([]);
			const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			const report = JSON.parse(
				w.p.db
					.prepare("SELECT report FROM signatures WHERE id = ?")
					.get(r.signatureId)!.report as string,
			);
			expect(readIdentity(report)).toMatchObject({
				status: "unrecognised_issuer",
				name: "Test Person",
				roles: ["cawg.creator"],
			});
			expect(r.status).toBe("unrecognised_issuer");
			// Signed source assets carry it too, for what their record holds.
			const tone = await signAsset(w.p, w.m, {
				assetId: w.id("tone.wav").id,
				engine,
			});
			const toneReport = JSON.parse(
				w.p.db
					.prepare("SELECT report FROM signatures WHERE id = ?")
					.get(tone.signatureId)!.report as string,
			);
			expect(readIdentity(toneReport)?.covers).toEqual(
				expect.arrayContaining([
					"c2pa.actions.v2",
					"stds.schema-org.CreativeWork",
					"c2pa.training-mining",
				]),
			);
		},
		120000,
	);

	it.skipIf(!haveOpenssl || name !== "library" || !ready)(
		"signs with a holder that keeps its key in memory, with nothing set up on this machine (D54)",
		async () => {
			const w = await world({ signing: false });
			const cert = devCertificate(folder("memory-holder"))!;
			const fingerprint = (await certificateInfo(cert.certificate)).fingerprint;
			const holder = memoryHolder(cert);
			const engine = await signingEngineFor(w.m, name);
			// Nothing is set up here, so without a holder it says so.
			await expect(
				signOutput(w.p, w.m, { assetId: w.film.id, engine }),
			).rejects.toThrow(/no certificate and key/);
			const r = await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine,
				holder,
			});
			expect(r.status).toBe("unrecognised_issuer");
			expect(
				w.p.db
					.prepare("SELECT certificate_sha256 FROM signatures WHERE id = ?")
					.get(r.signatureId),
			).toEqual({ certificate_sha256: fingerprint });
		},
		120000,
	);

	it.skipIf(!haveOpenssl || !ready)(
		"carries a source signed at ingest into the edit with its credentials from the sidecar",
		async () => {
			const w = await world();
			const engine = await signingEngineFor(w.m, name);
			await signAsset(w.p, w.m, { assetId: w.id("tone.wav").id, engine });
			const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			const tone = interpretReport(
				await readWith(name, path.join(w.media, r.path)),
			).ingredients.find((i: { title: string }) => i.title === "tone.wav");
			expect(tone).toMatchObject({ credentials: "present", problems: [] });
		},
		120000,
	);
});

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

describe.each(ENGINES)("signAsset with $name", ({ name, recorded, ready }) => {
	it.skipIf(!haveOpenssl || !ready)(
		"writes a sidecar both readers read back against the file",
		async () => {
			const w = await world();
			const still = w.id("still.png");
			const engine = await signingEngineFor(w.m, name);
			const r = await signAsset(w.p, w.m, { assetId: still.id, engine });
			expect(r).toMatchObject({ path: "still.c2pa", version: 1 });
			expect(r.status).toBe("unrecognised_issuer");
			const s = w.p.db
				.prepare("SELECT engine, report FROM signatures WHERE id = ?")
				.get(r.signatureId) as Record<string, unknown>;
			expect(s.engine).toBe(recorded);
			expect(JSON.parse(s.report as string)).toHaveProperty("active_manifest");
			for (const reader of ["library", "c2patool"] as const)
				if (ENGINES.find((e) => e.name === reader)!.ready)
					expect(
						interpretReport(
							await readWith(
								reader,
								path.join(w.media, "still.png"),
								path.join(w.media, "still.c2pa"),
							),
						).status,
					).toBe("unrecognised_issuer");
		},
		120000,
	);
});

describe("keeping a source's details out of the signed film (D62)", () => {
	it.skipIf(!haveOpenssl || !haveLibrary)(
		"lists what a source's credentials reveal, redacts it or leaves them out, records the choice, and carries it to the next signing",
		async () => {
			const w = await world();
			const loaded = await loadLibrary({}, { remoteManifests: false });
			if ("unavailable" in loaded) throw new Error(loaded.unavailable);
			// still.png gains credentials of its own, naming its author, as a
			// camera app or a generator would sign it; a rescan sees a re-render.
			await giveCredentials(w, loaded, "still.png", "A. Person");
			await scanAndRead(w, loaded);
			const stillAsset = liveAt(w, "still.png");

			// The preview says what it would reveal.
			const preview = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
			const source = preview.reveals.find((r) => r.assetId === stillAsset.id)!;
			const author = source.reveal.items.find((i) => i.kind === "author")!;
			expect(author).toMatchObject({ redactable: true, values: ["A. Person"] });
			expect(source.reveal.signers).toEqual([
				expect.stringMatching(DEV_CERT_NAME),
			]);
			expect(preview.lastWithheld).toBeNull();

			const engine = await signingEngineFor(w.m, "library");
			const read = async (rel: string) =>
				(await readStore(loaded, path.join(w.media, rel))) as {
					active_manifest: string;
					manifests: Record<
						string,
						{ assertions: Array<{ label: string; data: unknown }> }
					>;
				};
			const actionsOf = (store: Awaited<ReturnType<typeof read>>) =>
				(
					store.manifests[store.active_manifest].assertions.find((a) =>
						a.label.startsWith("c2pa.actions"),
					)!.data as {
						actions: Array<{
							action: string;
							parameters?: { redacted?: string };
						}>;
					}
				).actions;

			// Redacted: the author is gone, and the film says something was removed.
			const r1 = await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine,
				withhold: { redact: [author.uri], leaveOut: [] },
			});
			expect(r1).toMatchObject({
				status: "unrecognised_issuer",
				withheld: { redacted: 1, leftOut: 0 },
			});
			const one = await read(r1.path);
			expect(JSON.stringify(one)).not.toContain("A. Person");
			expect(actionsOf(one)).toContainEqual(
				expect.objectContaining({
					action: "c2pa.redacted",
					parameters: expect.objectContaining({ redacted: author.uri }),
				}),
			);
			expect(
				previewOutputStatement(w.p, w.m, { assetId: w.film.id }).lastWithheld,
			).toMatchObject({ redact: [author.uri], leaveOut: [], notes: [] });

			// Not said: as the last signing, never quietly revealed again.
			const r2 = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			expect(r2.withheld).toEqual({ redacted: 1, leftOut: 0 });
			expect(JSON.stringify(await read(r2.path))).not.toContain("A. Person");

			// Left out: none of the source's own credentials travel.
			const r3 = await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine,
				withhold: { redact: [], leaveOut: [stillAsset.id] },
			});
			expect(r3).toMatchObject({
				status: "unrecognised_issuer",
				withheld: { redacted: 0, leftOut: 1 },
			});
			const three = await read(r3.path);
			expect(Object.keys(three.manifests)).toEqual([three.active_manifest]);
			expect(JSON.stringify(three)).not.toContain("example-camera-app");
			const stored = JSON.parse(
				(
					w.p.db
						.prepare("SELECT definition FROM signatures WHERE id = ?")
						.get(r3.signatureId) as { definition: string }
				).definition,
			);
			expect(stored.credentials_left_out).toEqual([
				{ asset_id: stillAsset.id, label: "ing-1" },
			]);
			expect(
				(
					publicExport(w.p.db, r3.signatureId, {
						generatedAt: "2026-11-25T00:00:00.000Z",
						generator: { name: "provenance-tracker", version: "0" },
					}).data as { withheld: { fromSignedFile: number } }
				).withheld.fromSignedFile,
			).toBe(1);

			// Said and wrong: refused before anything is written.
			for (const withhold of [
				{
					redact: ["self#jumbf=/c2pa/urn:x/c2pa.assertions/c2pa.hash.data"],
					leaveOut: [],
				},
				{ redact: [], leaveOut: [w.id("tone.wav").id] },
			])
				await expect(
					signOutput(w.p, w.m, { assetId: w.film.id, engine, withhold }),
				).rejects.toThrow(NotReadyError);
			if (haveC2patool)
				await expect(
					signOutput(w.p, w.m, {
						assetId: w.film.id,
						engine: await signingEngineFor(w.m, "c2patool"),
						withhold: { redact: [author.uri], leaveOut: [] },
					}),
				).rejects.toThrow(/needs the C2PA library/);
		},
		180000,
	);
});

describe("what a signing remembers, and what it reads first (D63)", () => {
	const library = async () => {
		const loaded = await loadLibrary({}, { remoteManifests: false });
		if ("unavailable" in loaded) throw new Error(loaded.unavailable);
		return loaded;
	};
	const readBack = async (w: World, loaded: LoadedLibrary, rel: string) =>
		(await readStore(loaded, path.join(w.media, rel))) as ReadBack;

	it.skipIf(!haveOpenssl || !haveLibrary)(
		"keeps out of a re-rendered cut what the last signing kept out, and says so",
		async () => {
			const w = await world();
			const loaded = await library();
			const engine = await signingEngineFor(w.m, "library");
			// The cut carries credentials naming who exported it, as an editor's
			// export does.
			await giveCredentials(w, loaded, "export.png", "A. Person");
			await scanAndRead(w, loaded);
			w.cutTimeline(liveAt(w, "export.png").sha256);
			const first = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
			const author = first.reveals
				.find((r) => r.parent)!
				.reveal.items.find((i) => i.kind === "author")!;
			const r1 = await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine,
				withhold: { redact: [author.uri], leaveOut: [] },
			});
			expect(r1).toMatchObject({
				withheld: { redacted: 1, leftOut: 0 },
				notes: [],
			});
			expect(JSON.stringify(await readBack(w, loaded, r1.path))).not.toContain(
				"A. Person",
			);

			// The cut is rendered again and exported again: new bytes, signed
			// afresh, so the manifest that names the author has a new label and
			// the address remembered from the first signing matches nothing.
			tinyPng(path.join(w.media, "export.png"), [9, 9, 9]);
			await giveCredentials(w, loaded, "export.png", "A. Person");
			await scanAndRead(w, loaded);
			w.cutTimeline(liveAt(w, "export.png").sha256);
			const second = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
			const again = second.reveals
				.find((r) => r.parent)!
				.reveal.items.find((i) => i.kind === "author")!;
			expect(again.uri).not.toBe(author.uri);
			// The page starts from the choice, at its new address, and says why.
			expect(second.lastWithheld).toMatchObject({
				redact: [again.uri],
				redactions: [
					{ what: "an author's name in export.png", now: [again.uri] },
				],
			});
			expect(second.lastWithheld!.notes).toEqual([
				expect.stringMatching(
					/kept out an author's name in export\.png.*kept out of this copy too/,
				),
			]);

			// A signing that states no choice (the command line) keeps it out too.
			const r2 = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			expect(r2.withheld).toEqual({ redacted: 1, leftOut: 0 });
			expect(r2.notes).toEqual(second.lastWithheld!.notes);
			expect(JSON.stringify(await readBack(w, loaded, r2.path))).not.toContain(
				"A. Person",
			);
			// And it is remembered by source, assertion and kind for the next.
			const stored = JSON.parse(
				(
					w.p.db
						.prepare("SELECT definition FROM signatures WHERE id = ?")
						.get(r2.signatureId) as { definition: string }
				).definition,
			);
			expect(stored.redactions_by_source).toEqual([
				{
					asset_id: w.film.id,
					title: "export.png",
					label: "stds.schema-org.CreativeWork",
					kind: "author",
					uri: again.uri,
				},
			]);

			// Rendered again with nothing naming anyone: the choice has nothing
			// left to apply to, and the signing says that it dropped it.
			tinyPng(path.join(w.media, "export.png"), [7, 7, 7]);
			await scanAndRead(w, loaded);
			w.cutTimeline(liveAt(w, "export.png").sha256);
			const r3 = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			expect(r3.withheld).toEqual({ redacted: 0, leftOut: 0 });
			expect(r3.notes).toEqual([expect.stringMatching(/no longer carries it/)]);
		},
		180000,
	);

	it.skipIf(!haveOpenssl || !haveLibrary)(
		"refuses a source whose credentials the review never showed, until it has been read",
		async () => {
			const w = await world();
			const loaded = await library();
			const engine = await signingEngineFor(w.m, "library");
			// still.png gains credentials and is scanned, but not read.
			await giveCredentials(w, loaded, "still.png", "A. Person");
			await scanProject(w.p, w.m);
			const unread = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
			expect(unread.reveals).toEqual([]);
			expect(unread.blockers).toEqual([
				expect.stringMatching(
					/^Not read for Content Credentials yet.*still\.png/,
				),
			]);
			await expect(
				signOutput(w.p, w.m, { assetId: w.film.id, engine }),
			).rejects.toThrow(/still\.png carries .* is not what the review showed/);
			expect(existsSync(path.join(w.media, "export.signed.v1.png"))).toBe(
				false,
			);

			// Read: the review lists it, and what was listed is what goes in.
			await extractProject(w.p, w.m, { readers: libraryReaders(loaded) });
			const read = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
			expect(read.blockers).toEqual([]);
			expect(read.reveals.map((r) => r.title)).toEqual(["still.png"]);
			const r = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			expect(JSON.stringify(await readBack(w, loaded, r.path))).toContain(
				"A. Person",
			);
		},
		180000,
	);

	it.skipIf(!haveOpenssl)(
		"refuses a source changed since its scan, before anything is written",
		async () => {
			const w = await world();
			const { engine, calls } = stubEngine();
			// The same name, other bytes: the catalog knows the file as it was.
			tinyPng(path.join(w.media, "still.png"), [1, 2, 3]);
			await expect(
				signOutput(w.p, w.m, { assetId: w.film.id, engine }),
			).rejects.toThrow(/still\.png has changed since it was scanned/);
			expect(calls).toEqual([]);
			await scanProject(w.p, w.m);
			await extractProject(w.p, w.m, { readers: [noCredentials] });
			await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			expect(calls).toHaveLength(1);
		},
		60000,
	);

	it.skipIf(!haveOpenssl || !haveLibrary)(
		"uses a .c2pa sidecar only once the catalog knows it, and only with the bytes it knows",
		async () => {
			const w = await world();
			const loaded = await library();
			const engine = await signingEngineFor(w.m, "library");
			// A .c2pa lands beside a source after the scan: nobody has seen it.
			await giveCredentials(w, loaded, "tone.wav", "A. Person", {
				sidecar: true,
			});
			const r1 = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			const one = await readBack(w, loaded, r1.path);
			expect(Object.keys(one.manifests)).toEqual([one.active_manifest]);
			expect(JSON.stringify(one)).not.toContain("A. Person");

			// Scanned and read: the review lists what it says, and it travels.
			await scanAndRead(w, loaded);
			expect(
				previewOutputStatement(w.p, w.m, {
					assetId: w.film.id,
				}).reveals.map((r) => r.title),
			).toEqual(["tone.wav"]);
			const r2 = await signOutput(w.p, w.m, { assetId: w.film.id, engine });
			const two = await readBack(w, loaded, r2.path);
			expect(Object.keys(two.manifests)).toHaveLength(2);
			expect(JSON.stringify(two)).toContain("A. Person");

			// Replaced after the scan: refused.
			writeFileSync(path.join(w.media, "tone.c2pa"), "another sidecar");
			await expect(
				signOutput(w.p, w.m, { assetId: w.film.id, engine }),
			).rejects.toThrow(/tone\.c2pa has changed since it was scanned/);
		},
		180000,
	);

	it.skipIf(!haveOpenssl)(
		"signs credentials nobody could read only when they are left out, and nothing when nothing can read",
		async () => {
			const w = await world();
			const still = w.id("still.png");
			const failed = (file: string) =>
				makeObservation({
					kind: "c2pa",
					extractor: "stub",
					version: "1.0",
					...(path.basename(file) === "still.png"
						? { status: "unreadable", error: "a broken manifest" }
						: { status: "absent" }),
				});
			// `extract` could not read still.png's credentials, and neither can signing.
			await extractProject(w.p, w.m, {
				again: true,
				readers: [{ ...noCredentials, read: async (f) => failed(f) }],
			});
			const { engine, calls } = stubEngine();
			// Leaving credentials out is the library engine's to do.
			const reading = {
				...engine,
				name: "c2pa-node",
				read: async (f: string) => failed(f),
			};
			expect(
				previewOutputStatement(w.p, w.m, { assetId: w.film.id }).reveals,
			).toMatchObject([
				{ assetId: still.id, reveal: { unreadable: "a broken manifest" } },
			]);
			await expect(
				signOutput(w.p, w.m, { assetId: w.film.id, engine: reading }),
			).rejects.toThrow(
				/still\.png has Content Credentials that could not be read/,
			);
			expect(calls).toEqual([]);
			await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine: reading,
				withhold: { redact: [], leaveOut: [still.id] },
			});
			expect(calls[0].withhold).toEqual({ redact: [], leaveOut: ["ing-1"] });

			// A machine with no reader at all (c2patool without the library).
			const blind = {
				...engine,
				read: async () =>
					makeObservation({
						kind: "c2pa",
						extractor: "stub",
						status: "unavailable",
						error: "The C2PA library is not installed.",
					}),
			};
			await expect(
				signOutput(w.p, w.m, { assetId: w.film.id, engine: blind }),
			).rejects.toThrow(
				/first reads what each source carries, and nothing here can read it: The C2PA library is not installed\./,
			);
		},
		60000,
	);
});

describe("everything a source says is reviewed, and the signed copy is checked (D64)", () => {
	const library = async () => {
		const loaded = await loadLibrary({}, { remoteManifests: false });
		if ("unavailable" in loaded) throw new Error(loaded.unavailable);
		return loaded;
	};
	const readBack = async (w: World, loaded: LoadedLibrary, rel: string) =>
		(await readStore(loaded, path.join(w.media, rel))) as ReadBack;
	const signerOf = (w: World, signatureId: number) =>
		(
			publicExport(w.p.db, signatureId, {
				generatedAt: "2026-11-26T00:00:00.000Z",
				generator: { name: "provenance-tracker", version: "0" },
			}).data as {
				ingredients: Array<{ title: string; signerName: string }>;
			}
		).ingredients.find((i) => i.title === "still.png")!.signerName;

	it.skipIf(!haveOpenssl || !haveLibrary)(
		"lists a location in a C2PA metadata assertion, and takes it out of the film",
		async () => {
			const w = await world();
			const loaded = await library();
			const engine = await signingEngineFor(w.m, "library");
			// Where current cameras put a location: the C2PA metadata assertion.
			await giveCredentials(w, loaded, "still.png", "A. Person", {
				assertions: [
					{
						label: "c2pa.metadata",
						data: {
							"@context": { exif: "http://ns.adobe.com/exif/1.0/" },
							"exif:GPSLatitude": "41,24.2028N",
							"exif:GPSLongitude": "2,10.4418E",
						},
					},
					{ label: "com.example.note", data: { text: "shot at home" } },
				],
			});
			await scanAndRead(w, loaded);
			const { reveal } = previewOutputStatement(w.p, w.m, {
				assetId: w.film.id,
			}).reveals.find((r) => r.title === "still.png")!;
			const where = reveal.items.find((i) => i.label === "c2pa.metadata")!;
			expect(where).toMatchObject({
				kind: "location",
				values: ["41,24.2028N", "2,10.4418E"],
				redactable: true,
			});
			// Nothing is only counted that says something: the custom assertion
			// and the file name the manifest records are listed too.
			expect(reveal.items.map((i) => [i.kind, i.redactable])).toEqual([
				["names", false],
				["author", true],
				["location", true],
				["other", true],
			]);
			expect(reveal.generators).toEqual(["example-camera-app 1"]);

			const r = await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine,
				withhold: { redact: [where.uri], leaveOut: [] },
			});
			expect(r.withheld).toEqual({ redacted: 1, leftOut: 0 });
			const film = JSON.stringify(await readBack(w, loaded, r.path));
			expect(film).not.toContain("41,24.2028N");
			// What was not chosen stays.
			expect(film).toContain("shot at home");
		},
		180000,
	);

	it.skipIf(!haveOpenssl || !haveLibrary)(
		"names no signer, in the statement or the public record, for a source whose credentials are left out",
		async () => {
			const w = await world();
			const loaded = await library();
			const engine = await signingEngineFor(w.m, "library");
			await giveCredentials(w, loaded, "still.png", "A. Person");
			await scanAndRead(w, loaded);
			const still = liveAt(w, "still.png");
			// As classify records who signed a source.
			editRow(
				w.p.db,
				"assets",
				still.id,
				{ signed_by: "tool", signer_name: "Example Camera Co" },
				{ actor: ME },
			);
			const before = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
			expect(before.sourceSigners).toEqual([
				{ assetId: still.id, title: "still.png", signer: "Example Camera Co" },
			]);
			const author = before.reveals[0].reveal.items.find(
				(i) => i.kind === "author",
			)!;

			// Kept in: the statement and the public record name the signer.
			const r1 = await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine,
				withhold: { redact: [], leaveOut: [] },
			});
			expect(signerOf(w, r1.signatureId)).toBe("Example Camera Co");

			// Left out, with a redaction inside it that then has nothing to
			// remove: neither names it, and the film holds no trace of it.
			const r2 = await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine,
				withhold: { redact: [author.uri], leaveOut: [still.id] },
			});
			expect(r2.withheld).toEqual({ redacted: 0, leftOut: 1 });
			expect(signerOf(w, r2.signatureId)).toBe("");
			const film = await readBack(w, loaded, r2.path);
			expect(JSON.stringify(film)).not.toContain("Example Camera Co");
			expect(Object.keys(film.manifests)).toEqual([film.active_manifest]);
			const stored = w.p.db
				.prepare("SELECT statement, definition FROM signatures WHERE id = ?")
				.get(r2.signatureId) as { statement: string; definition: string };
			expect(stored.statement).not.toContain("Example Camera Co");
			// The choice made inside it is still remembered for the next signing.
			expect(JSON.parse(stored.definition)).toMatchObject({
				redactions: [],
				redactions_by_source: [{ asset_id: still.id, kind: "author" }],
			});

			// The preview shows the statement as the next signing would write it,
			// and still says whose name a different choice would bring back.
			const after = previewOutputStatement(w.p, w.m, { assetId: w.film.id });
			expect(JSON.stringify(after.statement)).not.toContain(
				"Example Camera Co",
			);
			expect(after.sourceSigners).toEqual(before.sourceSigners);
			expect(after.lastWithheld).toMatchObject({
				redact: [author.uri],
				leaveOut: [still.id],
			});
		},
		180000,
	);

	it.skipIf(!haveOpenssl)(
		"does not keep a signed copy that still holds what was to be kept out, or that does not read back sound",
		async () => {
			const w = await world();
			const still = w.id("still.png");
			const uri =
				"self#jumbf=/c2pa/urn:c2pa:cam/c2pa.assertions/stds.schema-org.CreativeWork";
			const carried = {
				active_manifest: "urn:c2pa:cam",
				manifests: {
					"urn:c2pa:cam": {
						assertions: [
							{
								label: "stds.schema-org.CreativeWork",
								data: { author: [{ name: "A. Person" }] },
							},
						],
					},
				},
			};
			const reading = (file: string) =>
				makeObservation({
					kind: "c2pa",
					extractor: "stub",
					version: "1.0",
					...(path.basename(file) === "still.png"
						? { status: "ok", data: carried }
						: { status: "absent" }),
				});
			await extractProject(w.p, w.m, {
				again: true,
				readers: [{ ...noCredentials, read: async (f) => reading(f) }],
			});
			const { engine } = stubEngine();
			const signed = path.join(w.media, "export.signed.v1.png");
			/** An engine that claims to withhold, and reads back this report. */
			const reads = (report: Record<string, unknown>) => ({
				...engine,
				name: "c2pa-node",
				read: async (f: string) => reading(f),
				sign: async (args: Parameters<SigningEngine["sign"]>[0]) => {
					await engine.sign(args);
					return { report };
				},
			});
			const sound = soundReport() as { manifests: Record<string, unknown> };

			// The redacted assertion is still listed in the copy.
			await expect(
				signOutput(w.p, w.m, {
					assetId: w.film.id,
					engine: reads({
						...sound,
						manifests: { ...sound.manifests, ...carried.manifests },
					}),
					withhold: { redact: [uri], leaveOut: [] },
				}),
			).rejects.toThrow(
				/stds\.schema-org\.CreativeWork is still in the signed copy\. The signed copy was not kept\./,
			);
			expect(existsSync(signed)).toBe(false);

			// The left-out source's manifest is still in the copy.
			await expect(
				signOutput(w.p, w.m, {
					assetId: w.film.id,
					engine: reads({
						...sound,
						manifests: { ...sound.manifests, "urn:c2pa:cam": {} },
					}),
					withhold: { redact: [], leaveOut: [still.id] },
				}),
			).rejects.toThrow(
				/credentials of a source that was left out are still in the signed copy/,
			);
			expect(existsSync(signed)).toBe(false);

			// Nothing withheld, but the copy does not read back as sound.
			await expect(
				signOutput(w.p, w.m, {
					assetId: w.film.id,
					engine: reads({
						...sound,
						validation_results: {
							activeManifest: {
								failure: [{ code: "claimSignature.mismatch" }],
							},
						},
					}),
					withhold: { redact: [], leaveOut: [] },
				}),
			).rejects.toThrow(/read back as "Invalid".*was not kept/);
			expect(existsSync(signed)).toBe(false);
			expect(
				w.p.db.prepare("SELECT count(*) AS n FROM signatures").get(),
			).toEqual({ n: 0 });

			// Gone from the copy: kept and recorded.
			const r = await signOutput(w.p, w.m, {
				assetId: w.film.id,
				engine: reads(sound),
				withhold: { redact: [uri], leaveOut: [] },
			});
			expect(r.withheld).toEqual({ redacted: 1, leftOut: 0 });
			expect(existsSync(signed)).toBe(true);
		},
		60000,
	);

	it.skipIf(!haveOpenssl)(
		"shows what the cut and the thumbnail carry in their own metadata",
		async () => {
			const w = await world();
			const poster = await withPoster(w);
			const tags: Record<string, Record<string, unknown>> = {
				"export.png": {
					ImageWidth: 2,
					WindowsAtomUncProjectPath: "D:\\Work\\Example Client\\cut.prproj",
					Artist: "A. Person",
				},
				"poster.png": { GPSLatitude: 41.4036 },
			};
			await extractProject(w.p, w.m, {
				readers: [
					noCredentials,
					{
						kind: "exif",
						extractor: "exiftool",
						version: "13",
						read: async (file) =>
							makeObservation({
								kind: "exif",
								extractor: "exiftool",
								version: "13",
								status: "ok",
								data: tags[path.basename(file)] ?? {},
							}),
					},
				],
			});
			expect(
				previewOutputStatement(w.p, w.m, { assetId: w.film.id }).filesCarry,
			).toEqual([
				{
					assetId: w.film.id,
					title: "export.png",
					role: "cut",
					read: true,
					details: [
						{
							tag: "WindowsAtomUncProjectPath",
							value: "D:\\Work\\Example Client\\cut.prproj",
							kind: "path",
						},
						{ tag: "Artist", value: "A. Person", kind: "person" },
					],
					more: 0,
				},
				{
					assetId: poster.id,
					title: "poster.png",
					role: "thumbnail",
					read: true,
					details: [{ tag: "GPSLatitude", value: "41.4036", kind: "location" }],
					more: 0,
				},
			]);
			// Not read by ExifTool: the review says so, and shows nothing.
			const bare = await world();
			expect(
				previewOutputStatement(bare.p, bare.m, { assetId: bare.film.id })
					.filesCarry,
			).toMatchObject([{ role: "cut", read: false, details: [] }]);
		},
		60000,
	);
});

describe("sameName", () => {
	it("ignores case and spacing, and nothing else", () => {
		expect(sameName(" A.  Maker ", "a. maker")).toBe(true);
		// Found 25 Nov 2026: the pattern matched the letter s, not spaces.
		expect(sameName("Ross", "Ros")).toBe(false);
		expect(sameName("Jess Lane", "Je Lane")).toBe(false);
	});
});
