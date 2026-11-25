// The holder for key files on this machine (D54): the certificate chain and
// the private key as PEM files whose paths this machine's settings name per
// project (D41). The key is read when the holder is opened, just before
// signing, checked to belong to the certificate, and let go with the holder
// when the signing ends (D53, decision 4a); its contents are never logged,
// returned or kept.

import {
	createPrivateKey,
	createPublicKey,
	X509Certificate,
	type KeyObject,
} from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { algorithmOf } from "../certificates.ts";
import { signBytes, type CredentialHolder } from "../holder.ts";

export const KEY_FILES = "key-files";

/** Open the key files: the chain and the key, the key checked against the chain's first certificate. */
export async function keyFilesHolder(paths: {
	certificatePath: string;
	privateKeyPath: string;
}): Promise<CredentialHolder> {
	if (!paths.certificatePath || !existsSync(paths.certificatePath))
		throw new Error(
			"The signing certificate is not there. Check this project's signing settings.",
		);
	if (!paths.privateKeyPath || !existsSync(paths.privateKeyPath))
		throw new Error(
			"The signing key is not there. Check this project's signing settings.",
		);
	const chain = await readFile(paths.certificatePath, "utf8");
	let key: KeyObject;
	try {
		key = createPrivateKey(await readFile(paths.privateKeyPath));
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
	const alg = algorithmOf(chain);
	return {
		kind: KEY_FILES,
		chain,
		alg,
		sign: async (data) => signBytes(alg, key, data),
		keyFiles: { ...paths },
	};
}
