// What every signing engine does, whichever program does it (D53): sign a
// file (or write a .c2pa sidecar for it) from a definition built by
// manifest/build.js, and read back what it wrote. The engines are in
// engines/: the C2PA library (the default) and c2patool (the fallback a
// machine can choose).

import {
	createPrivateKey,
	createPublicKey,
	X509Certificate,
	type KeyObject,
} from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface SignIngredient {
	label: string;
	relationship: string;
	title?: string;
	filePath?: string;
	/** The file being signed is this ingredient (the parent). */
	useInput?: boolean;
}

/**
 * A file the definition names by identifier, such as the claim thumbnail
 * (build.js names it by its hash).
 */
export interface SignResource {
	identifier: string;
	filePath: string;
}

export interface SignArgs {
	inputPath: string;
	/** Must not exist: a signed copy never replaces a file. */
	outputPath: string;
	definition: Record<string, unknown>;
	ingredients: SignIngredient[];
	/** Files the definition names, such as the claim thumbnail. */
	resources?: SignResource[];
	certificatePath: string;
	privateKeyPath: string;
	/** RFC 3161 time-stamp authority; left out in tests (no network). */
	timestampUrl?: string;
	/** Write the manifest to outputPath as a .c2pa sidecar; the input is untouched. */
	sidecar?: boolean;
	log?: (line: string) => void;
}

/** What signs: the C2PA library by default (engines/index.ts); tests give a stand-in. */
export interface SigningEngine {
	/** As recorded on each signature: "c2pa-node" or "c2patool". */
	name: string;
	version: string;
	/** Sign, then read back what was written: the report becomes the signature's status. */
	sign: (args: SignArgs) => Promise<{ report: Record<string, unknown> | null }>;
	/**
	 * The credentials a file carries itself, if any, and who signed them; null
	 * when it has none. A file that has them is not signed at ingest.
	 */
	readEmbedded: (file: string) => Promise<{ signer: string } | null>;
}

// An identifier is a plain file name: it must not reach outside the folder.
const RESOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Refuse, before anything is written, what no engine should sign: a missing
 * input, an output that already exists, missing key files, a resource named
 * like a path or not there.
 */
export function checkSignArgs(args: SignArgs): void {
	if (!existsSync(args.inputPath))
		throw new Error(
			`File to sign is missing: ${path.basename(args.inputPath)}`,
		);
	if (existsSync(args.outputPath))
		throw new Error(`Refusing to overwrite ${path.basename(args.outputPath)}`);
	if (!args.certificatePath || !existsSync(args.certificatePath))
		throw new Error(
			"The signing certificate is not there. Check this project's signing settings.",
		);
	if (!args.privateKeyPath || !existsSync(args.privateKeyPath))
		throw new Error(
			"The signing key is not there. Check this project's signing settings.",
		);
	for (const res of args.resources ?? []) {
		if (!RESOURCE_NAME.test(res.identifier) || res.identifier.includes(".."))
			throw new Error(`Not a plain file name: ${res.identifier}`);
		if (!existsSync(res.filePath))
			throw new Error(
				`A file the credentials take is missing: ${path.basename(res.filePath)}`,
			);
	}
	for (const ing of args.ingredients)
		if (!ing.useInput && (!ing.filePath || !existsSync(ing.filePath)))
			throw new Error(
				`Ingredient file is missing: ${ing.title || path.basename(ing.filePath ?? "")}`,
			);
}

/**
 * The certificate chain and the private key, the key checked to belong to the
 * chain's first certificate before anything is signed. Read once per signing
 * and let go (D53, decision 4a); the key's contents are never logged or kept.
 */
export async function loadSigningKey(
	certificatePath: string,
	privateKeyPath: string,
): Promise<{ chain: string; key: KeyObject }> {
	const chain = await readFile(certificatePath, "utf8");
	let key: KeyObject;
	try {
		key = createPrivateKey(await readFile(privateKeyPath));
	} catch (err) {
		// Node's message names the format problem, never the key's contents.
		throw new Error(
			`The signing key does not read as a private key (PEM): ${(err as Error).message}`,
			{ cause: err },
		);
	}
	const derOf = (k: KeyObject) =>
		k.export({ type: "spki", format: "der" }).toString("base64");
	if (
		derOf(createPublicKey(key)) !== derOf(new X509Certificate(chain).publicKey)
	)
		throw new Error(
			"The signing key does not belong to the signing certificate. Check this project's signing settings.",
		);
	return { chain, key };
}

const SIGNER_FIELDS = ["private_key", "sign_cert", "ta_url", "alg"];

/**
 * The definition as recorded: what was signed, without the signer's key
 * material paths or the temp ingredient folders.
 */
export function storableDefinition(
	definition: Record<string, unknown>,
): Record<string, unknown> {
	const out = { ...definition };
	for (const f of [...SIGNER_FIELDS, "ingredient_paths"]) delete out[f];
	return out;
}
