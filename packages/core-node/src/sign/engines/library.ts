// Signing through the C2PA library (@contentauth/c2pa-node): the default
// engine (D53). The library builds and embeds the manifest, and asks for the
// bytes it hands over to be signed (a callback), so the private key is held
// by whatever holds it (holders/, D54) and never passes into the library.
//
// Ingredients are read by the library itself, against the same trust lists
// and remote-credentials setting as `extract` (c2pa-library.ts): D15's "the
// library judges camera files" holds while signing too. A source signed at
// ingest carries its credentials in a .c2pa sidecar (D13); the library reads
// only embedded ones, so the sidecar goes in as the ingredient's manifest
// store, with the library's reading of it, as the c2patool engine does.
//
// The creator's identity (D55), when there is one, is a CAWG identity
// assertion the library adds as it signs: it asks for a finished COSE_Sign1
// over its signer payload, which core's cose.ts builds and the identity's own
// holder signs. The library drops a label it cannot find without a word, so
// what the read-back says the identity covers is checked against what was
// asked for, and a copy that falls short is not kept.

import { X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sidecarPathFor } from "@provenancetracker/core/manifest/build.js";
import { mediaTypeForSigning } from "@provenancetracker/core/manifest/formats.ts";
import { coseSign1 } from "@provenancetracker/core/manifest/cose.ts";
import { readIdentity } from "@provenancetracker/core/manifest/identity.ts";
import { readStore, type LoadedLibrary } from "../../extract/c2pa-library.ts";
import { checkSignArgs, type SignArgs, type SigningEngine } from "../engine.ts";

/** The name recorded on signatures the library made (the reader's name too). */
export const LIBRARY_ENGINE = "c2pa-node";

/** The DER certificates of a PEM chain, the signer's first. */
export function derChain(chainPem: string): Buffer[] {
	return (
		chainPem.match(
			/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
		) ?? []
	).map((pem) => new X509Certificate(pem).raw);
}

/** Room the library leaves for the signature: the chain, the signature itself, and a time stamp's reply. */
export function reserveFor(chainPem: string, timeStamped: boolean): number {
	const der = derChain(chainPem).reduce((n, c) => n + c.length, 0);
	return der + 4096 + (timeStamped ? 16384 : 0);
}

type Lib = LoadedLibrary["lib"];

/**
 * What signs: the claim signer with the creator's identity assertion added
 * to it (D55). The library asks for a finished COSE_Sign1 over its signer
 * payload; the identity's own holder signs it.
 */
async function signerWithIdentity(
	lib: Lib,
	claimSigner: ReturnType<Lib["CallbackSigner"]["newSigner"]>,
	identity: NonNullable<SignArgs["identity"]>,
) {
	const { holder } = identity;
	const certificates = derChain(holder.chain);
	const credential = lib.CallbackCredentialHolder.newCallbackCredentialHolder(
		reserveFor(holder.chain, false),
		"cawg.x509.cose",
		async (payload) =>
			Buffer.from(
				await coseSign1({
					alg: holder.alg,
					certificates,
					payload: lib.encodeSignerPayload(payload),
					sign: async (bytes) => holder.sign(Buffer.from(bytes)),
				}),
			),
	);
	const assertion =
		await lib.IdentityAssertionBuilder.identityBuilderForCredentialHolder(
			credential,
		);
	assertion.addReferencedAssertions(identity.covers);
	assertion.addRoles(identity.roles);
	const signer = lib.IdentityAssertionSigner.new(claimSigner.getHandle());
	signer.addIdentityAssertion(assertion);
	return signer;
}

async function addIngredients(
	loaded: LoadedLibrary,
	builder: InstanceType<LoadedLibrary["lib"]["Builder"]>,
	args: SignArgs,
): Promise<void> {
	const leaveOut = new Set(args.withhold?.leaveOut ?? []);
	for (const ing of args.ingredients) {
		const file = ing.useInput ? args.inputPath : ing.filePath!;
		const asset = { path: file, mimeType: mediaTypeForSigning(file) };
		const record: Record<string, unknown> = {
			title: ing.title || path.basename(file),
			relationship: ing.relationship,
			label: ing.label,
		};
		if (leaveOut.has(ing.label)) {
			// Named, with its format, but none of its own credentials carried:
			// the library reads nothing from the file (Phase 8 step 4).
			await builder.addIngredient(
				JSON.stringify({ ...record, format: asset.mimeType }),
			);
			continue;
		}
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
	const { holder } = args;
	const claimSigner = lib.CallbackSigner.newSigner(
		{
			alg: holder.alg,
			certs: [Buffer.from(holder.chain)],
			reserveSize: reserveFor(holder.chain, !!args.timestampUrl),
			...(args.timestampUrl ? { tsaUrl: args.timestampUrl } : {}),
			directCoseHandling: false,
		},
		(data) => holder.sign(data),
	);
	const signer = args.identity
		? await signerWithIdentity(lib, claimSigner, args.identity)
		: claimSigner;
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
		// Each withheld assertion is removed, and the file says so with a
		// c2pa.redacted action giving the reason.
		for (const uri of args.withhold?.redact ?? [])
			builder.addRedaction(uri, "c2pa.PII.present");
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
	const report = (
		args.sidecar
			? await readStore(loaded, args.inputPath, args.outputPath)
			: await readStore(loaded, args.outputPath)
	) as Record<string, unknown> | null;
	if (args.identity) {
		// The library drops a label it cannot find without a word.
		const reading = readIdentity(report);
		const covers = new Set(reading?.covers ?? []);
		const missing = args.identity.covers.filter((l) => !covers.has(l));
		if (!reading || missing.length) {
			await rm(args.outputPath, { force: true }).catch(() => {});
			throw new Error(
				`Signing failed: the identity did not cover ${missing.join(", ") || "the record"}. Nothing was kept.`,
			);
		}
	}
	return { report };
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
