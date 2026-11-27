// The page's own search for the signing certificate in a copy (D72):
// against stores built here byte by byte, to try what a real signer never
// writes, and against files signed with the real library and a throwaway
// certificate, to show it finds the certificate the library validated with.
import { describe, it, expect, beforeAll } from "vitest";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	certificateOfStore,
	decodeCbor,
	signingCertificate,
	NotSure,
} from "../../../public-viewer/src/certificate.js";
import { sha256Hex } from "../../../public-viewer/src/sha256.js";
import { loadLibrary } from "../../../packages/core-node/src/extract/c2pa-library.ts";
import {
	devCertificate,
	haveOpenssl,
} from "../../../packages/core-node/test/helpers/cert.ts";

// ---- just enough CBOR and JUMBF to write a store by hand

const bytes = (...parts: Array<number[] | Uint8Array | Buffer>) =>
	Buffer.concat(parts.map((p) => Buffer.from(p as Uint8Array)));
const head = (major: number, n: number) =>
	n < 24
		? [(major << 5) | n]
		: n < 256
			? [(major << 5) | 24, n]
			: [(major << 5) | 25, n >> 8, n & 255];
type Cbor =
	number | string | Uint8Array | Cbor[] | Map<number | string, Cbor> | null;
function enc(v: Cbor): Buffer {
	if (v === null) return bytes([0xf6]);
	if (typeof v === "number") return bytes(v < 0 ? head(1, -1 - v) : head(0, v));
	if (typeof v === "string")
		return bytes(head(3, Buffer.byteLength(v)), Buffer.from(v));
	if (v instanceof Uint8Array) return bytes(head(2, v.length), v);
	if (Array.isArray(v)) return bytes(head(4, v.length), ...v.map(enc));
	return bytes(
		head(5, v.size),
		...[...v].flatMap(([k, x]) => [enc(k), enc(x)]),
	);
}
const box = (type: string, ...parts: Buffer[]) => {
	const body = Buffer.concat(parts);
	const h = Buffer.alloc(8);
	h.writeUInt32BE(8 + body.length, 0);
	h.write(type, 4, "latin1");
	return Buffer.concat([h, body]);
};
const jumb = (label: string, ...children: Buffer[]) =>
	box(
		"jumb",
		box("jumd", Buffer.alloc(16, 1), bytes([3]), Buffer.from(`${label}\0`)),
		...children,
	);

const CERT_A = Buffer.from("certificate A, as it would be in DER");
const CERT_B = Buffer.from("certificate B");
/** A signature box whose COSE headers are as given. */
const signature = (
	protectedHeaders: Map<number | string, Cbor>,
	unprotected: Map<number | string, Cbor> = new Map(),
	wrap: (cose: Buffer) => Buffer = (c) => bytes([0xd2], c), // tag 18
) =>
	jumb(
		"c2pa.signature",
		box(
			"cbor",
			wrap(
				enc([
					protectedHeaders.size ? enc(protectedHeaders) : new Uint8Array(),
					unprotected,
					null,
					new Uint8Array(64),
				]),
			),
		),
	);
const manifest = (label: string, sig: Buffer) =>
	jumb(
		label,
		jumb("c2pa.assertions"),
		jumb("c2pa.claim.v2", box("cbor", enc(new Map()))),
		sig,
	);
const store = (...manifests: Buffer[]) => jumb("c2pa", ...manifests);
const chainOf = (...certs: Buffer[]) =>
	new Map<number | string, Cbor>([
		[1, -7],
		[33, certs.length === 1 ? certs[0] : certs],
	]);
const why = (fn: () => unknown) => {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(NotSure);
		return (err as Error).message;
	}
	throw new Error("it did not give up");
};

describe("the signing certificate in a manifest store", () => {
	it("is the first of the chain in the last manifest's one signature", () => {
		const one = certificateOfStore(
			store(manifest("urn:c2pa:film", signature(chainOf(CERT_A)))),
		);
		expect(one.label).toBe("urn:c2pa:film");
		expect(Buffer.from(one.certificate)).toEqual(CERT_A);
		// A chain of two: the signer's is first.
		expect(
			Buffer.from(
				certificateOfStore(
					store(manifest("urn:c2pa:film", signature(chainOf(CERT_A, CERT_B)))),
				).certificate,
			),
		).toEqual(CERT_A);
		// A source's manifest comes first; the film's own, the active one, last.
		const two = certificateOfStore(
			store(
				manifest("urn:c2pa:source", signature(chainOf(CERT_B))),
				manifest("urn:c2pa:film", signature(chainOf(CERT_A))),
			),
		);
		expect(two.label).toBe("urn:c2pa:film");
		expect(Buffer.from(two.certificate)).toEqual(CERT_A);
		// Older signatures keep the chain outside the protected headers, or spell its name.
		for (const sig of [
			signature(new Map([[1, -7]]), new Map([[33, CERT_A]])),
			signature(new Map([[1, -7]]), new Map([["x5chain", CERT_A]])),
			signature(chainOf(CERT_A), new Map(), (c) => c), // untagged
		])
			expect(
				Buffer.from(
					certificateOfStore(store(manifest("urn:c2pa:film", sig))).certificate,
				),
			).toEqual(CERT_A);
	});

	it("gives up, with a reason, on anything a second reading could take another way", () => {
		const film = (sig: Buffer) => store(manifest("urn:c2pa:film", sig));
		// Two chains: which would a reader verify with?
		expect(
			why(() =>
				certificateOfStore(
					film(signature(chainOf(CERT_A), new Map([[33, CERT_B]]))),
				),
			),
		).toMatch(/exactly one certificate chain/);
		expect(
			why(() =>
				certificateOfStore(
					film(
						signature(
							new Map<number | string, Cbor>([
								[33, CERT_A],
								["x5chain", CERT_B],
							]),
						),
					),
				),
			),
		).toMatch(/exactly one certificate chain/);
		expect(
			why(() => certificateOfStore(film(signature(new Map([[1, -7]]))))),
		).toMatch(/exactly one certificate chain/);
		// Two manifests of one name, two signatures, two stores.
		expect(
			why(() =>
				certificateOfStore(
					store(
						manifest("urn:c2pa:film", signature(chainOf(CERT_B))),
						manifest("urn:c2pa:film", signature(chainOf(CERT_A))),
					),
				),
			),
		).toMatch(/same name/);
		expect(
			why(() =>
				certificateOfStore(
					store(
						jumb(
							"urn:c2pa:film",
							signature(chainOf(CERT_A)),
							signature(chainOf(CERT_B)),
						),
					),
				),
			),
		).toMatch(/exactly one signature/);
		const whole = film(signature(chainOf(CERT_A)));
		expect(
			why(() => certificateOfStore(Buffer.concat([whole, whole]))),
		).toMatch(/more than one set of credentials/);
		// Bytes left over after the signature, and a signature that is not one.
		expect(
			why(() =>
				certificateOfStore(
					film(
						signature(chainOf(CERT_A), new Map(), (c) =>
							bytes([0xd2], c, [0x00]),
						),
					),
				),
			),
		).toMatch(/bytes after its signature/);
		expect(
			why(() =>
				certificateOfStore(
					film(jumb("c2pa.signature", box("cbor", enc([1, 2, 3])))),
				),
			),
		).toMatch(/not the kind this page reads/);
		// Not credentials at all, and cut short.
		expect(why(() => certificateOfStore(jumb("other")))).toMatch(
			/not laid out as expected/,
		);
		expect(why(() => certificateOfStore(whole.subarray(0, 40)))).toMatch(
			/wrong size|ends early/,
		);
		expect(why(() => certificateOfStore(store()))).toMatch(/no manifest/);
	});

	it("reads only CBOR of a stated length, and is not led into a long loop by a count", () => {
		const [one, a, nine] = decodeCbor(enc([1, "a", new Uint8Array([9])]))
			.value as [number, string, Uint8Array];
		expect([one, a, [...nine]]).toEqual([1, "a", [9]]);
		// An indefinite-length list, a map that repeats a key, a list of four
		// thousand million items in three bytes.
		expect(why(() => decodeCbor(bytes([0x9f, 0x01, 0xff])))).toMatch(
			/form this page does not read/,
		);
		expect(
			why(() => decodeCbor(bytes([0xa2, 0x01, 0x01, 0x01, 0x02]))),
		).toMatch(/one thing twice/);
		const started = Date.now();
		expect(
			why(() => decodeCbor(bytes([0x9a, 0xff, 0xff, 0xff, 0xff, 0x01]))),
		).toMatch(/ends early/);
		expect(Date.now() - started).toBeLessThan(1000);
		let deep = bytes([0x01]);
		for (let i = 0; i < 40; i++) deep = bytes([0x81], deep);
		expect(why(() => decodeCbor(deep))).toMatch(/nested too deeply/);
	});
});

// ---- real files, signed with the pinned library and a throwaway certificate

/** The smallest thing shaped like an MP4: a type, an empty movie, some data. */
function tinyMp4(): Buffer {
	const mvhd = Buffer.alloc(100);
	mvhd.writeUInt32BE(1000, 12);
	mvhd.writeUInt32BE(1000, 16);
	mvhd.writeUInt32BE(0x00010000, 20);
	mvhd.writeUInt16BE(0x0100, 24);
	mvhd.writeUInt32BE(0x00010000, 36);
	mvhd.writeUInt32BE(0x00010000, 52);
	mvhd.writeUInt32BE(0x40000000, 68);
	mvhd.writeUInt32BE(2, 96);
	return Buffer.concat([
		box(
			"ftyp",
			Buffer.from("isom"),
			Buffer.alloc(4),
			Buffer.from("isomiso2mp41"),
		),
		box("moov", box("mvhd", mvhd)),
		box("mdat", Buffer.alloc(256, 7)),
	]);
}
function wav(): Buffer {
	const data = Buffer.alloc(1600);
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
	return Buffer.concat([h, data]);
}
const DEFINITION = (title: string, format: string) => ({
	claim_generator_info: [{ name: "provenance-tracker test", version: "0" }],
	title,
	format,
	assertions: [
		{
			label: "c2pa.actions",
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
});

const loaded = await loadLibrary({}, {});
const ready = haveOpenssl && !("unavailable" in loaded);

describe.skipIf(!ready)("the signing certificate in a signed file", () => {
	let dir = "";
	let fingerprint = "";
	const signed: Record<
		string,
		{ file: string; active: string; sidecar: Buffer }
	> = {};

	beforeAll(async () => {
		if ("unavailable" in loaded) return;
		const { lib, context } = loaded;
		dir = mkdtempSync(path.join(tmpdir(), "pt-certificate-"));
		const cert = devCertificate(dir)!;
		const chain = readFileSync(cert.certificate, "utf8");
		fingerprint = new X509Certificate(chain).fingerprint256
			.replaceAll(":", "")
			.toLowerCase();
		const signer = lib.LocalSigner.newSigner(
			Buffer.from(chain),
			Buffer.from(
				createPrivateKey(readFileSync(cert.privateKey)).export({
					type: "pkcs8",
					format: "pem",
				}),
			),
			"es256",
		);
		for (const [name, format, make] of [
			["tiny.mp4", "video/mp4", tinyMp4],
			["tone.wav", "audio/wav", wav],
		] as const) {
			const plain = path.join(dir, name);
			writeFileSync(plain, make());
			const file = path.join(dir, `signed.${name}`);
			const builder = await lib.Builder.withJsonAsync(
				DEFINITION(name, format) as never,
				context,
			);
			builder.sign(signer, { path: plain, mimeType: format }, { path: file });
			const reader = await lib.Reader.fromAsset({ path: file }, context);
			// The same credentials on their own, as a .c2pa file holds them.
			const apart = await lib.Builder.withJsonAsync(
				DEFINITION(name, format) as never,
				context,
			);
			apart.setNoEmbed(true);
			const sidecar = apart.sign(
				signer,
				{ path: plain, mimeType: format },
				{ path: path.join(dir, `apart.${name}`) },
			);
			signed[name] = {
				file,
				active: (reader!.json() as { active_manifest: string }).active_manifest,
				sidecar,
			};
		}
		return () => rmSync(dir, { recursive: true, force: true });
	}, 120000);

	it.each(["tiny.mp4", "tone.wav"])(
		"finds, in %s, the certificate of the manifest the library calls active: the one the tracker records",
		async (name) => {
			const { file, active } = signed[name];
			expect(await signingCertificate(new Blob([readFileSync(file)]))).toEqual({
				label: active,
				sha256: fingerprint,
			});
		},
	);

	it("finds it in credentials kept apart from the file (.c2pa)", async () => {
		const found = await signingCertificate(
			new Blob([signed["tiny.mp4"].sidecar]),
		);
		expect(found.sha256).toBe(fingerprint);
	});

	it("gives up on a file with a second set of credentials pasted on, on one with none, and on a kind it does not read", async () => {
		const reason = async (data: Buffer) => {
			try {
				await signingCertificate(new Blob([data]));
			} catch (err) {
				expect(err).toBeInstanceOf(NotSure);
				return (err as Error).message;
			}
			throw new Error("it did not give up");
		};
		// The film's own credentials box, copied onto the end of the file.
		const film = readFileSync(signed["tiny.mp4"].file);
		let at = 0;
		let pasted = Buffer.alloc(0);
		while (at < film.length) {
			const size = film.readUInt32BE(at);
			if (film.toString("latin1", at + 4, at + 8) === "uuid")
				pasted = film.subarray(at, at + size);
			at += size;
		}
		expect(pasted.length).toBeGreaterThan(0);
		expect(await reason(Buffer.concat([film, pasted]))).toMatch(
			/more than one set of credentials/,
		);
		expect(await reason(tinyMp4())).toMatch(
			/no credentials this page can find/,
		);
		expect(await reason(wav())).toMatch(/no credentials this page can find/);
		expect(await reason(film.subarray(0, film.length - 10))).toMatch(
			/wrong size|middle of a part/,
		);
		// A PNG is read (the tracker's own tests sign one); this one has no credentials.
		expect(
			await reason(Buffer.from("\x89PNG\r\n\x1a\n0000IHDR", "latin1")),
		).toMatch(/no credentials this page can find/);
		expect(await reason(Buffer.from("ID3 and the rest of an MP3"))).toMatch(
			/only in MP4, MOV, WAV, PNG and \.c2pa files/,
		);
		expect(await reason(Buffer.from("short"))).toMatch(/too short/);
	});

	it("hashes the certificate as the tracker does: SHA-256 of its DER", () => {
		const der = new X509Certificate(
			readFileSync(path.join(dir, "test-certs-es256", "c2pa-dev-cert.pem")),
		).raw;
		expect(sha256Hex(der)).toBe(fingerprint);
	});
});
