// Reading Content Credentials with the C2PA library (D51), for real: a file
// signed here with a throwaway certificate (never certs/), read back with
// the pinned library and trust list. Skipped where openssl, c2patool or the
// library is not installed (npm run tools:fetch).

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
	versionMismatch,
} from "../src/extract/c2pa-library.ts";
import { c2patoolPath, c2patoolProblem } from "../src/extract/c2patool.ts";
import { notPinned, pinOf } from "../src/pinned.ts";
import { signWithC2patool } from "../src/sign/engines/c2patool.ts";
import { keyFilesHolder } from "../src/sign/holders/key-files.ts";
import { devCertificate, haveOpenssl } from "./helpers/cert.ts";

const haveC2patool =
	spawnSync(c2patoolPath({}, process.platform), ["--version"]).status === 0;
const haveLibrary = existsSync(PINNED_BINARY);
// Tests use no network: these files carry their credentials inside them anyway.
const NO_REMOTE = { remoteManifests: false };

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
	it("fetches remote credentials only as the machine's setting says, never OCSP, trust given as text", () => {
		const on = readerSettings("-----BEGIN CERTIFICATE-----", {
			remoteManifests: true,
		});
		expect(on.verify).toMatchObject({
			remoteManifestFetch: true,
			ocspFetch: false,
			verifyTrust: true,
		});
		expect(on.trust.trustAnchors).toMatch(/^-----BEGIN/);
		expect(on.trust).not.toHaveProperty("userAnchors");
		expect(
			readerSettings("x", { remoteManifests: false }).verify
				.remoteManifestFetch,
		).toBe(false);
	});
});

describe("what may be loaded and run (D69)", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "pt-pinned-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
	const pin = pinOf("c2pa-node")!;

	it("loads no library binary a setting names: the override is refused", () => {
		const elsewhere = path.join(dir, "elsewhere", "index.node");
		expect(libraryBinary({ C2PA_LIBRARY_PATH: elsewhere })).toEqual({
			unavailable: expect.stringMatching(
				/^C2PA_LIBRARY_PATH is set\. The tracker loads only .* take that setting out\.$/,
			),
		});
		// The tracker's own setting of it, to the pinned copy, is not an override.
		const own = libraryBinary({ C2PA_LIBRARY_PATH: PINNED_BINARY });
		if (haveLibrary)
			expect(own).toEqual({
				path: PINNED_BINARY,
				version: pin.version,
			});
	});

	it("loads a binary only while its bytes are the pinned ones", () => {
		// A file where the library goes, with other bytes.
		const other = path.join(dir, "index.node");
		writeFileSync(other, "not the library");
		expect(libraryBinary({}, { file: other })).toEqual({
			unavailable: expect.stringMatching(
				/^tools\/c2pa-node\/index\.node is not the pinned copy: .* so it is not loaded\. Run npm run tools:fetch -- --force\.$/,
			),
		});
		// A record beside it that says otherwise changes nothing: only the
		// hash in tracked source counts.
		writeFileSync(
			`${other}.pinned.json`,
			JSON.stringify({ version: pin.version, sha256: "0".repeat(64) }),
		);
		expect(libraryBinary({}, { file: other })).toHaveProperty("unavailable");
		expect(libraryBinary({}, { file: path.join(dir, "missing.node") })).toEqual(
			{
				unavailable:
					"The C2PA library's native binary is not installed. Run npm run tools:fetch.",
			},
		);
		// A kind of machine with no pinned binary has none to load.
		expect(libraryBinary({}, { platform: "freebsd", arch: "x64" })).toEqual({
			unavailable: expect.stringMatching(/no pinned binary for freebsd-x64/),
		});
	});

	it("refuses a package and a binary of different releases", () => {
		expect(versionMismatch(pin.version, pin.version)).toBeNull();
		expect(versionMismatch("0.13.0", pin.version)).toMatch(
			/package is 0\.13\.0 and the binary in tools\/ is the one pinned for .* same release/,
		);
	});

	it("tells a file that is the pinned one from one that is not, and sees it change", () => {
		const file = path.join(dir, "list.pem");
		writeFileSync(file, "pinned bytes");
		const sha = createHash("sha256").update("pinned bytes").digest("hex");
		expect(notPinned(file, sha, "The list")).toBeNull();
		writeFileSync(file, "other bytes, longer");
		expect(notPinned(file, sha, "The list", "Fetch it again.")).toBe(
			"The list is not the pinned copy: its bytes are not the ones recorded in scripts/lib/pinned-tools.mjs, so it is not loaded. Fetch it again.",
		);
	});

	it("runs no c2patool a setting names, none from PATH, and none that is not the pinned program", () => {
		// The path is the copy in tools/, whatever the environment says.
		expect(c2patoolPath({ C2PATOOL_PATH: "/x/c2patool" }, "linux")).toBe(
			c2patoolPath({}, "linux"),
		);
		expect(c2patoolPath({}, "linux")).toMatch(
			/tools[\\/]c2patool[\\/]c2patool$/,
		);
		expect(c2patoolProblem({ C2PATOOL_PATH: "/x/c2patool" })).toMatch(
			/^C2PATOOL_PATH is set\./,
		);
		expect(c2patoolProblem({}, "linux", "arm64")).toMatch(
			/no pinned download for linux-arm64/,
		);
		if (haveC2patool) expect(c2patoolProblem({})).toBeNull();
	});

	it.skipIf(!haveLibrary)(
		"has, on this machine, the library and the trust lists that are pinned",
		async () => {
			expect(libraryBinary({})).toEqual({
				path: PINNED_BINARY,
				version: pin.version,
			});
			const reader = await loadLibraryReader({}, NO_REMOTE);
			expect(reader).not.toHaveProperty("unavailable");
			expect((reader as { version: string }).version).toBe(pin.version);
		},
	);
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
				holder: await keyFilesHolder({
					certificatePath: cert.certificate,
					privateKeyPath: cert.privateKey,
				}),
				sidecar,
			});
			return out;
		};

		it("reads a file signed with a certificate no list knows as valid, with an unrecognised issuer", async () => {
			const file = await signed("signed.wav");
			const o = await readC2paWithLibrary(
				await loadLibraryReader({}, NO_REMOTE),
				file,
			);
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
				await loadLibraryReader(
					{},
					{ remoteManifests: false, userAnchors: ca },
				),
				file,
			);
			expect(o.validation!.failures).toEqual([]);
			expect(o.validation!.state).toBe("Trusted");
			// The library says so in a code of its own; "valid" rests on that
			// code, never on the absence of a failure (D67).
			expect(
				(
					o.data as {
						validation_results: {
							activeManifest: { success: Array<{ code: string }> };
						};
					}
				).validation_results.activeManifest.success.map((s) => s.code),
			).toContain("signingCredential.trusted");
			expect(interpretReport(o.data as object).status).toBe("valid");
		}, 60000);

		it("reads a .c2pa sidecar against the file it describes", async () => {
			const sidecar = await signed("tone.c2pa", true);
			const o = await readC2paWithLibrary(
				await loadLibraryReader({}, NO_REMOTE),
				plain,
				sidecar,
			);
			expect(o).toMatchObject({ kind: "c2pa-sidecar", status: "ok" });
			expect(interpretReport(o.data as object).status).toBe(
				"unrecognised_issuer",
			);
		}, 60000);

		it("says a file has no credentials, and a type C2PA cannot hold is absent, not unreadable", async () => {
			const reader = await loadLibraryReader({}, NO_REMOTE);
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
			const o = await readC2paWithLibrary(
				await loadLibraryReader({}, NO_REMOTE),
				broken,
			);
			expect(o.status).toBe("unreadable");
			expect(o.error).toMatch(/^C2PA library: /);
		}, 60000);
	},
);
