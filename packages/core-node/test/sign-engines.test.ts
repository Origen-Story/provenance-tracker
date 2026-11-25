// The signing engines themselves (D53): the bytes each algorithm signs, the
// library's trust settings, picking an engine, and a real sign-and-read-back
// for every key type with each engine, using certificates made in the test's
// own temp folder.

import { describe, expect, it, type TestContext } from "vitest";
import { spawnSync } from "node:child_process";
import {
	constants,
	generateKeyPairSync,
	verify as cryptoVerify,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { interpretReport } from "@provenancetracker/core/manifest/verify.js";
import { c2patoolPath } from "../src/extract/c2patool.ts";
import {
	PINNED_BINARY,
	withTimeStampAnchors,
} from "../src/extract/c2pa-library.ts";
import { updateSettings } from "../src/settings.ts";
import type { SigningEngine } from "../src/sign/engine.ts";
import { signingEngineFor } from "../src/sign/engines/index.ts";
import { reserveFor, signBytes } from "../src/sign/engines/library.ts";
import {
	devCertificate,
	haveOpenssl,
	type DevKeyType,
} from "./helpers/cert.ts";
import { machinesForTests } from "./helpers/machine.ts";

const { machine, folder } = machinesForTests();

const haveLibrary = existsSync(PINNED_BINARY);
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

/** A 2x2 PNG: a file both engines sign, embedded or as a sidecar. */
function tinyPng(file: string) {
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
	const row = Buffer.from([0, 9, 9, 9, 9, 9, 9]);
	writeFileSync(
		file,
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk("IHDR", ihdr),
			chunk("IDAT", deflateSync(Buffer.concat([row, row]))),
			chunk("IEND", Buffer.alloc(0)),
		]),
	);
}

const DEFINITION = {
	claim_generator_info: [{ name: "provenance-tracker", version: "test" }],
	title: "still.png",
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
	],
};

describe("signBytes", () => {
	it("signs as C2PA wants each algorithm: raw r‖s for ECDSA, PSS for RSA, Ed25519 as it is", () => {
		const data = Buffer.from("the bytes the library hands over");
		const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
		const es = signBytes("es256", ec.privateKey, data);
		expect(es.length).toBe(64); // r‖s, not DER
		expect(
			cryptoVerify(
				"sha256",
				data,
				{ key: ec.publicKey, dsaEncoding: "ieee-p1363" },
				es,
			),
		).toBe(true);
		const ec384 = generateKeyPairSync("ec", { namedCurve: "P-384" });
		expect(signBytes("es384", ec384.privateKey, data).length).toBe(96);
		const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const ps = signBytes("ps256", rsa.privateKey, data);
		expect(
			cryptoVerify(
				"sha256",
				data,
				{
					key: rsa.publicKey,
					padding: constants.RSA_PKCS1_PSS_PADDING,
					saltLength: 32,
				},
				ps,
			),
		).toBe(true);
		const ed = generateKeyPairSync("ed25519");
		const sig = signBytes("ed25519", ed.privateKey, data);
		expect(cryptoVerify(null, data, ed.publicKey, sig)).toBe(true);
	});
});

describe("the library's trust settings", () => {
	it("add the C2PA time-stamp list as its own kind of anchor, keeping the others", () => {
		const wire = {
			verify: { verify_trust: true },
			trust: {
				anchors: [
					{
						trust_anchors: "CLAIMS",
						trust_uri: "manifest_system_anchors",
						trust_kind: "manifest",
					},
				],
			},
		};
		expect(withTimeStampAnchors(wire, "TSA")).toEqual({
			verify: { verify_trust: true },
			trust: {
				anchors: [
					{
						trust_anchors: "CLAIMS",
						trust_uri: "manifest_system_anchors",
						trust_kind: "manifest",
					},
					{
						trust_anchors: "TSA",
						trust_uri: "tsa_system_anchors",
						trust_kind: "tsa",
					},
				],
			},
		});
		expect(withTimeStampAnchors({}, "TSA")).toEqual({
			trust: {
				anchors: [
					{
						trust_anchors: "TSA",
						trust_uri: "tsa_system_anchors",
						trust_kind: "tsa",
					},
				],
			},
		});
	});

	it("leave room for a time stamp's reply when one is asked for", () => {
		const dir = folder("reserve");
		const cert = devCertificate(dir);
		if (!cert) return;
		const chain = readFileSync(cert.certificate, "utf8");
		expect(reserveFor(chain, true)).toBeGreaterThan(reserveFor(chain, false));
		expect(reserveFor(chain, false)).toBeGreaterThan(4096);
	});
});

describe("choosing the engine", () => {
	it("is the library unless this machine's setting or the command line says c2patool", async () => {
		const m = machine();
		if (haveLibrary) expect((await signingEngineFor(m)).name).toBe("c2pa-node");
		expect((await signingEngineFor(m, "c2patool")).name).toBe("c2patool");
		updateSettings(m.settingsPath, (s) => {
			s.signingEngine = "c2patool";
		});
		expect((await signingEngineFor(m)).name).toBe("c2patool");
		if (haveLibrary)
			expect((await signingEngineFor(m, "library")).name).toBe("c2pa-node");
	});
});

const KEY_TYPES: DevKeyType[] = ["es256", "es384", "ps256", "ed25519"];
const ENGINES = [
	{ name: "library", ready: haveLibrary },
	{ name: "c2patool", ready: haveC2patool },
] as const;

describe.each(ENGINES)("the $name engine", ({ name, ready }) => {
	if (!haveOpenssl || !ready) {
		it.skip("needs openssl and the engine on this machine", () => {});
		return;
	}
	const engineHere = (dir: string): Promise<SigningEngine> =>
		signingEngineFor(machine({ dir }), name);

	it.for(KEY_TYPES)(
		"signs with a %s key, into the file and into a sidecar, and reads both back",
		{ timeout: 120000 },
		async (keyType: DevKeyType, ctx: TestContext) => {
			const dir = folder(`${name}-${keyType}`);
			const cert = devCertificate(dir, keyType);
			// This machine's openssl cannot make this kind of key (older LibreSSL).
			if (!cert) return ctx.skip();
			const engine = await engineHere(dir);
			const input = path.join(dir, "still.png");
			tinyPng(input);
			const before = readFileSync(input);
			const base = {
				inputPath: input,
				definition: DEFINITION,
				ingredients: [
					{
						label: "parent",
						relationship: "parentOf",
						title: "still.png",
						useInput: true,
					},
				],
				certificatePath: cert.certificate,
				privateKeyPath: cert.privateKey,
			};
			const embedded = await engine.sign({
				...base,
				outputPath: path.join(dir, "still.signed.png"),
			});
			const sidecar = await engine.sign({
				...base,
				outputPath: path.join(dir, "still.c2pa"),
				sidecar: true,
			});
			for (const { report } of [embedded, sidecar]) {
				const v = interpretReport(report) as {
					status: string;
					hashVerified: boolean;
					signer: { commonName?: string } | null;
				};
				expect(v.status).toBe("unrecognised_issuer");
				expect(v.hashVerified).toBe(true);
				expect(v.signer?.commonName).toBe("Origen Story Dev Signing Cert");
			}
			// An original is never changed (CLAUDE.md).
			expect(readFileSync(input).equals(before)).toBe(true);
			expect(
				await engine.readEmbedded(path.join(dir, "still.signed.png")),
			).toEqual({
				signer: "Origen Story Dev Signing Cert",
			});
			// The sidecar beside it is not the file's own (c2patool alone would say it is).
			expect(await engine.readEmbedded(input)).toBeNull();
		},
	);

	it("refuses a key that is not the certificate's, or an output already there, writing nothing", async () => {
		const dir = folder(`${name}-refuse`);
		const cert = devCertificate(dir)!;
		const other = devCertificate(folder(`${name}-other`))!;
		const engine = await engineHere(dir);
		const input = path.join(dir, "still.png");
		tinyPng(input);
		const out = path.join(dir, "still.signed.png");
		const args = {
			inputPath: input,
			outputPath: out,
			definition: DEFINITION,
			ingredients: [],
			certificatePath: cert.certificate,
			privateKeyPath: other.privateKey,
		};
		await expect(engine.sign(args)).rejects.toThrow(
			/does not belong to the signing certificate/,
		);
		expect(existsSync(out)).toBe(false);
		writeFileSync(out, "already here");
		await expect(
			engine.sign({ ...args, privateKeyPath: cert.privateKey }),
		).rejects.toThrow(/Refusing to overwrite/);
		expect(readFileSync(out, "utf8")).toBe("already here");
	}, 120000);
});
