// Signing through the C2PA library (@contentauth/c2pa-node): the default
// engine (D53). The library builds and embeds the manifest; this machine's
// Node signs the bytes it is handed (a callback), so the private key is read
// here, once per signing, and never passes into the library. Node reads the
// key as the files hold it (SEC1, PKCS#1 or PKCS#8 PEM), so nothing is
// converted.
//
// Ingredients are read by the library itself, against the same trust lists
// and remote-credentials setting as `extract` (c2pa-library.ts): D15's "the
// library judges camera files" holds while signing too. A source signed at
// ingest carries its credentials in a .c2pa sidecar (D13); the library reads
// only embedded ones, so the sidecar goes in as the ingredient's manifest
// store, with the library's reading of it, as the c2patool engine does.

import {
	constants,
	sign as cryptoSign,
	X509Certificate,
	type KeyObject,
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sidecarPathFor } from "@provenancetracker/core/manifest/build.js";
import { mediaTypeForSigning } from "@provenancetracker/core/manifest/formats.ts";
import { readStore, type LoadedLibrary } from "../../extract/c2pa-library.ts";
import { algorithmFor, type SigningAlg } from "../certificates.ts";
import {
	checkSignArgs,
	loadSigningKey,
	type SignArgs,
	type SigningEngine,
} from "../engine.ts";

/** The name recorded on signatures the library made (the reader's name too). */
export const LIBRARY_ENGINE = "c2pa-node";

const DIGEST: Record<SigningAlg, string | null> = {
	es256: "sha256",
	es384: "sha384",
	es512: "sha512",
	ps256: "sha256",
	ed25519: null,
};

/**
 * Sign bytes as the C2PA algorithm wants them: ECDSA as the raw r‖s pair
 * (not DER), RSA as PSS with a salt the length of the digest, Ed25519 as it
 * is. The library wraps the signature in COSE itself.
 */
export function signBytes(
	alg: SigningAlg,
	key: KeyObject,
	data: Buffer,
): Buffer {
	const digest = DIGEST[alg];
	if (alg.startsWith("es"))
		return cryptoSign(digest, data, { key, dsaEncoding: "ieee-p1363" });
	if (alg === "ps256")
		return cryptoSign(digest, data, {
			key,
			padding: constants.RSA_PKCS1_PSS_PADDING,
			saltLength: 32,
		});
	return cryptoSign(null, data, key);
}

/** Room the library leaves for the signature: the chain, the signature itself, and a time stamp's reply. */
export function reserveFor(chainPem: string, timeStamped: boolean): number {
	const der = (
		chainPem.match(
			/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
		) ?? []
	).reduce((n, pem) => n + new X509Certificate(pem).raw.length, 0);
	return der + 4096 + (timeStamped ? 16384 : 0);
}

async function addIngredients(
	loaded: LoadedLibrary,
	builder: InstanceType<LoadedLibrary["lib"]["Builder"]>,
	args: SignArgs,
): Promise<void> {
	for (const ing of args.ingredients) {
		const file = ing.useInput ? args.inputPath : ing.filePath!;
		const asset = { path: file, mimeType: mediaTypeForSigning(file) };
		const record: Record<string, unknown> = {
			title: ing.title || path.basename(file),
			relationship: ing.relationship,
			label: ing.label,
		};
		const sidecar = sidecarPathFor(file);
		if (!ing.useInput && existsSync(sidecar)) {
			const own = await readStore(loaded, file).catch(() => null);
			const fromSidecar = (
				own ? null : await readStore(loaded, file, sidecar).catch(() => null)
			) as { active_manifest?: string; validation_results?: unknown } | null;
			if (fromSidecar?.active_manifest) {
				const identifier = `${ing.label}-manifest.c2pa`;
				await builder.addResource(identifier, {
					buffer: await readFile(sidecar),
					mimeType: "application/c2pa",
				});
				Object.assign(record, {
					format: asset.mimeType,
					manifest_data: { format: "application/c2pa", identifier },
					active_manifest: fromSidecar.active_manifest,
					validation_results: fromSidecar.validation_results,
				});
			}
		}
		await builder.addIngredient(JSON.stringify(record), asset);
	}
}

/**
 * Sign `inputPath` into `outputPath` with a definition from build.js, or
 * write its manifest to `outputPath` as a .c2pa sidecar (D13), then read back
 * what was written with the same library.
 */
export async function signWithLibrary(
	loaded: LoadedLibrary,
	args: SignArgs,
): Promise<{ report: Record<string, unknown> | null }> {
	checkSignArgs(args);
	const { lib, context } = loaded;
	const alg = await algorithmFor(args.certificatePath);
	const { chain, key } = await loadSigningKey(
		args.certificatePath,
		args.privateKeyPath,
	);
	const signer = lib.CallbackSigner.newSigner(
		{
			alg,
			certs: [Buffer.from(chain)],
			reserveSize: reserveFor(chain, !!args.timestampUrl),
			...(args.timestampUrl ? { tsaUrl: args.timestampUrl } : {}),
			directCoseHandling: false,
		},
		async (data) => signBytes(alg, key, data),
	);
	const input = {
		path: args.inputPath,
		mimeType: mediaTypeForSigning(args.inputPath),
	};
	const scratch = args.sidecar
		? await mkdtemp(path.join(os.tmpdir(), "pt-c2pa-"))
		: null;
	args.log?.(
		`signing ${path.basename(args.inputPath)} -> ${path.basename(args.outputPath)} (${args.ingredients.length} ingredients)`,
	);
	try {
		const builder = await lib.Builder.withJsonAsync(
			args.definition as Parameters<typeof lib.Builder.withJsonAsync>[0],
			context,
		);
		for (const res of args.resources ?? [])
			await builder.addResource(res.identifier, {
				path: res.filePath,
				mimeType: mediaTypeForSigning(res.filePath),
			});
		await addIngredients(loaded, builder, args);
		if (scratch) {
			// The library still writes a copy of the asset; it goes in the temp
			// folder, and only the manifest it returns is kept.
			builder.setNoEmbed(true);
			const manifest = await builder.signAsync(signer, input, {
				path: path.join(scratch, path.basename(args.inputPath)),
			});
			await writeFile(args.outputPath, manifest, { flag: "wx" });
		} else {
			await builder.signAsync(signer, input, { path: args.outputPath });
		}
	} catch (err) {
		if (!scratch && existsSync(args.outputPath))
			await rm(args.outputPath, { force: true }).catch(() => {});
		throw new Error(`Signing failed: ${(err as Error).message}`, {
			cause: err,
		});
	} finally {
		if (scratch)
			await rm(scratch, { recursive: true, force: true }).catch(() => {});
	}
	const report = args.sidecar
		? await readStore(loaded, args.inputPath, args.outputPath)
		: await readStore(loaded, args.outputPath);
	return { report: report as Record<string, unknown> | null };
}

/** The library, loaded with this machine's reading settings, as the engine. */
export function libraryEngine(loaded: LoadedLibrary): SigningEngine {
	return {
		name: LIBRARY_ENGINE,
		version: loaded.version,
		sign: (args) => signWithLibrary(loaded, args),
		readEmbedded: async (file) => {
			const store = (await readStore(loaded, file).catch(() => null)) as {
				active_manifest?: string;
				manifests?: Record<
					string,
					{ signature_info?: { common_name?: string; issuer?: string } }
				>;
			} | null;
			if (!store?.active_manifest) return null;
			const info = store.manifests?.[store.active_manifest]?.signature_info;
			return { signer: info?.common_name || info?.issuer || "" };
		},
	};
}
