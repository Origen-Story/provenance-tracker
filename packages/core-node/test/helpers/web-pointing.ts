// A file that keeps its Content Credentials on the web, for tests (D74): a
// short WAV signed with a throwaway certificate, its manifest kept out of the
// file and only an address written in, as Adobe Firefly video does. The
// address is never asked: tests hand the manifest over themselves.

import { createPrivateKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LoadedLibrary } from "../../src/extract/c2pa-library.ts";

/** A 16-bit mono WAV of a tone; `seed` makes its bytes differ. */
export function toneWav(seed = 8): Buffer {
	const samples = 4000;
	const data = Buffer.alloc(samples * 2);
	for (let i = 0; i < samples; i++)
		data.writeInt16LE(Math.round(Math.sin(i / seed) * 8000), i * 2);
	const head = Buffer.alloc(44);
	head.write("RIFF", 0);
	head.writeUInt32LE(36 + data.length, 4);
	head.write("WAVEfmt ", 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(1, 22);
	head.writeUInt32LE(8000, 24);
	head.writeUInt32LE(16000, 28);
	head.writeUInt16LE(2, 32);
	head.writeUInt16LE(16, 34);
	head.write("data", 36);
	head.writeUInt32LE(data.length, 40);
	return Buffer.concat([head, data]);
}

/**
 * Write `name` in `dir` carrying only `address` for its credentials.
 * @returns the file, and the manifest store the address would give
 */
export async function webPointingWav(
	loaded: LoadedLibrary,
	cert: { certificate: string; privateKey: string },
	dir: string,
	address: string,
	name = "pointing.wav",
): Promise<{ file: string; manifest: Buffer }> {
	const { lib, context } = loaded;
	const plain = path.join(dir, `plain-${name}`);
	writeFileSync(plain, toneWav());
	const builder = await lib.Builder.withJsonAsync(
		{
			claim_generator_info: [{ name: "provenancetracker-test", version: "0" }],
			title: name,
			format: "audio/wav",
			assertions: [
				{
					label: "c2pa.actions",
					data: {
						actions: [
							{
								action: "c2pa.created",
								digitalSourceType:
									"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
							},
						],
					},
				},
			],
		} as never,
		context,
	);
	builder.setRemoteUrl(address);
	builder.setNoEmbed(true);
	const signer = lib.LocalSigner.newSigner(
		readFileSync(cert.certificate),
		Buffer.from(
			createPrivateKey(readFileSync(cert.privateKey)).export({
				type: "pkcs8",
				format: "pem",
			}),
		),
		"es256",
	);
	const file = path.join(dir, name);
	const manifest = builder.sign(
		signer,
		{ path: plain, mimeType: "audio/wav" },
		{ path: file },
	);
	return { file, manifest: Buffer.from(manifest) };
}
