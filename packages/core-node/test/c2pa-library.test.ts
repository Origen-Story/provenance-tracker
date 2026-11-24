// Reading Content Credentials with the C2PA library (D51), for real: a file
// signed here with a throwaway certificate (never certs/), read back with
// the pinned library and trust list. Skipped where openssl, c2patool or the
// library is not installed (npm run tools:fetch).

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { interpretReport } from "@provenancetracker/core/manifest/verify.js";
import {
	PINNED_BINARY,
	libraryBinary,
	loadLibraryReader,
	readC2paWithLibrary,
	readerSettings,
} from "../src/extract/c2pa-library.ts";
import { c2patoolPath } from "../src/extract/c2patool.ts";
import { signWithC2patool } from "../src/sign/c2patool-sign.ts";
import { devCertificate, haveOpenssl } from "./helpers/cert.ts";

const haveC2patool =
	spawnSync(c2patoolPath({}, process.platform), ["--version"]).status === 0;
const haveLibrary = existsSync(PINNED_BINARY);

/** A silent 16-bit mono WAV of a tenth of a second. */
function wav(): Buffer {
	const samples = 4410;
	const data = Buffer.alloc(samples * 2);
	const h = Buffer.alloc(44);
	h.write("RIFF", 0);
	h.writeUInt32LE(36 + data.length, 4);
	h.write("WAVEfmt ", 8);
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(1, 20);
	h.writeUInt16LE(1, 22);
	h.writeUInt32LE(44100, 24);
	h.writeUInt32LE(88200, 28);
	h.writeUInt16LE(2, 32);
	h.writeUInt16LE(16, 34);
	h.write("data", 36);
	h.writeUInt32LE(data.length, 40);
	return Buffer.concat([h, data]);
}

const DEFINITION = {
	claim_generator_info: [{ name: "provenancetracker-test", version: "0" }],
	title: "tone.wav",
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

describe("readerSettings", () => {
	it("never lets reading go online: no remote manifests, no OCSP, trust given as text", () => {
		const s = readerSettings("-----BEGIN CERTIFICATE-----");
		expect(s.verify).toMatchObject({
			remoteManifestFetch: false,
			ocspFetch: false,
			verifyTrust: true,
		});
		expect(s.trust.trustAnchors).toMatch(/^-----BEGIN/);
		expect(s.trust).not.toHaveProperty("userAnchors");
	});
});

describe("libraryBinary", () => {
	it("takes C2PA_LIBRARY_PATH when it is set", () => {
		expect(libraryBinary({ C2PA_LIBRARY_PATH: "/x/index.node" })).toEqual({
			path: "/x/index.node",
		});
	});
});

describe.skipIf(!haveOpenssl || !haveC2patool || !haveLibrary)(
	"reading with the C2PA library",
	() => {
		const dir = mkdtempSync(path.join(tmpdir(), "pt-c2pa-lib-"));
		afterAll(() =>
			rmSync(dir, { recursive: true, force: true, maxRetries: 10 }),
		);
		const cert = devCertificate(dir)!;
		const tool = c2patoolPath({}, process.platform);
		const plain = path.join(dir, "tone.wav");
		writeFileSync(plain, wav());

		const signed = async (name: string, sidecar = false) => {
			const out = path.join(dir, name);
			await signWithC2patool({
				tool,
				inputPath: plain,
				outputPath: out,
				definition: DEFINITION,
				certificatePath: cert.certificate,
				privateKeyPath: cert.privateKey,
				sidecar,
			});
			return out;
		};

		it("reads a file signed with a certificate no list knows as valid, with an unrecognised issuer", async () => {
			const file = await signed("signed.wav");
			const o = await readC2paWithLibrary(await loadLibraryReader({}), file);
			expect(o).toMatchObject({
				kind: "c2pa",
				extractor: "c2pa-node",
				status: "ok",
			});
			expect(o.version).toMatch(/^\d+\.\d+\.\d+/);
			// The library calls this "Invalid"; the codes say only the issuer is unknown.
			expect(o.validation!.failures).toEqual(["signingCredential.untrusted"]);
			expect(interpretReport(o.data as object).status).toBe(
				"unrecognised_issuer",
			);
		}, 60000);

		it("reads the same file as trusted once this machine trusts the certificate's authority", async () => {
			const file = path.join(dir, "signed.wav");
			const ca = readFileSync(
				path.join(path.dirname(cert.certificate), "_ca-cert.pem"),
				"utf8",
			);
			const o = await readC2paWithLibrary(
				await loadLibraryReader({}, { userAnchors: ca }),
				file,
			);
			expect(o.validation!.failures).toEqual([]);
			expect(o.validation!.state).toBe("Trusted");
			expect(interpretReport(o.data as object).status).toBe("valid");
		}, 60000);

		it("reads a .c2pa sidecar against the file it describes", async () => {
			const sidecar = await signed("tone.c2pa", true);
			const o = await readC2paWithLibrary(
				await loadLibraryReader({}),
				plain,
				sidecar,
			);
			expect(o).toMatchObject({ kind: "c2pa-sidecar", status: "ok" });
			expect(interpretReport(o.data as object).status).toBe(
				"unrecognised_issuer",
			);
		}, 60000);

		it("says a file has no credentials, and a type C2PA cannot hold is absent, not unreadable", async () => {
			const reader = await loadLibraryReader({});
			expect((await readC2paWithLibrary(reader, plain)).status).toBe("absent");
			const notes = path.join(dir, "notes.md");
			writeFileSync(notes, "# notes");
			const o = await readC2paWithLibrary(reader, notes);
			expect(o.status).toBe("absent");
			expect(o.error).toMatch(/does not read this file type/);
		}, 60000);

		it("says a damaged file is unreadable", async () => {
			const broken = path.join(dir, "broken.mp4");
			writeFileSync(broken, "not a video");
			const o = await readC2paWithLibrary(await loadLibraryReader({}), broken);
			expect(o.status).toBe("unreadable");
			expect(o.error).toMatch(/^C2PA library: /);
		}, 60000);
	},
);
