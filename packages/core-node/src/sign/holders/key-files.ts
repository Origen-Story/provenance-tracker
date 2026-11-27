// The holder for key files on this machine (D54): the certificate chain and
// the private key as PEM files whose paths this machine's settings name per
// project (D41). The key is read when the holder is opened, just before
// signing, checked to belong to the certificate, and let go with the holder
// when the signing ends (D53, decision 4a); its contents are never logged,
// returned or kept, and the bytes read from the file are cleared once the
// key is made from them. What goes wrong is said without the files' paths:
// the message reaches a page, and where a key is kept is nobody else's to
// know. A certificate outside its dates does not sign: every reader would
// call the result invalid (D85).

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

/** Why a file that is there could not be read, without its path: "EACCES", or the error's first words. */
function why(err: unknown): string {
	const e = err as NodeJS.ErrnoException;
	return e.code ?? "it could not be opened";
}

/**
 * Open the key files: the chain and the key, the key checked against the
 * chain's first certificate, and the certificate against today's date.
 * @param opts.now for tests; the time the certificate must be valid at
 */
export async function keyFilesHolder(
	paths: {
		certificatePath: string;
		privateKeyPath: string;
	},
	opts: { now?: Date } = {},
): Promise<CredentialHolder> {
	if (!paths.certificatePath || !existsSync(paths.certificatePath))
		throw new Error(
			"The signing certificate is not there. Check this project's signing settings.",
		);
	if (!paths.privateKeyPath || !existsSync(paths.privateKeyPath))
		throw new Error(
			"The signing key is not there. Check this project's signing settings.",
		);
	let chain: string;
	let certificate: X509Certificate;
	try {
		chain = await readFile(paths.certificatePath, "utf8");
	} catch (err) {
		throw new Error(
			`The signing certificate file could not be read (${why(err)}). Check this project's signing settings.`,
			// Kept for the server's own log; only the message reaches a page.
			{ cause: err },
		);
	}
	try {
		certificate = new X509Certificate(chain);
	} catch {
		throw new Error(
			"The signing certificate does not read as a certificate (PEM). Check this project's signing settings.",
		);
	}
	let bytes: Buffer;
	try {
		bytes = await readFile(paths.privateKeyPath);
	} catch (err) {
		throw new Error(
			`The signing key file could not be read (${why(err)}). Check this project's signing settings.`,
			{ cause: err },
		);
	}
	let key: KeyObject;
	try {
		key = createPrivateKey(bytes);
	} catch (err) {
		// Node's message names the format problem, never the key's contents.
		throw new Error(
			`The signing key does not read as a private key (PEM): ${(err as Error).message}`,
			{ cause: err },
		);
	} finally {
		// The key object holds what signing needs; the file's bytes are done with.
		bytes.fill(0);
	}
	const derOf = (k: KeyObject) =>
		k.export({ type: "spki", format: "der" }).toString("base64");
	if (derOf(createPublicKey(key)) !== derOf(certificate.publicKey))
		throw new Error(
			"The signing key does not belong to the signing certificate. Check this project's signing settings.",
		);
	const now = (opts.now ?? new Date()).getTime();
	const day = (text: string) => new Date(text).toISOString().slice(0, 10);
	if (Date.parse(certificate.validTo) < now)
		throw new Error(
			`The certificate expired on ${day(certificate.validTo)}. A file signed with it now would read as invalid to every reader, so nothing was signed. Set a current certificate in this project's signing settings.`,
		);
	if (Date.parse(certificate.validFrom) > now)
		throw new Error(
			`The certificate is not valid until ${day(certificate.validFrom)}. A file signed with it now would read as invalid to every reader, so nothing was signed. Check this machine's clock, or this project's signing settings.`,
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
