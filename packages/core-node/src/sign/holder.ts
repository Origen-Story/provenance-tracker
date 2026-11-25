// What holds a signing key (D54, Phase 7 step 4): whatever it is, it hands
// over the certificate chain and signs the bytes it is given. The holders are
// in holders/: today one, key files on this machine. A system keychain, a
// hardware token or a remote signing service would each be another module
// with this shape (docs/planned-features.md), and signing would not change.

import { constants, sign as cryptoSign, type KeyObject } from "node:crypto";
import type { SigningAlg } from "./certificates.ts";

export interface CredentialHolder {
	/** Which module holds the key, as it is named in the registry: "key-files". */
	kind: string;
	/** The certificate chain as PEM text, the signer's own certificate first. */
	chain: string;
	/** The algorithm the key signs with, from its certificate. */
	alg: SigningAlg;
	/** Sign bytes as C2PA wants them for `alg`; the engine wraps them in COSE. */
	sign: (data: Buffer) => Promise<Buffer>;
	/**
	 * Where the key files are, for an engine that must open them itself
	 * (c2patool). Only key files on this machine have them.
	 */
	keyFiles?: { certificatePath: string; privateKeyPath: string };
}

const DIGEST: Record<SigningAlg, string | null> = {
	es256: "sha256",
	es384: "sha384",
	es512: "sha512",
	ps256: "sha256",
	ed25519: null,
};

/**
 * Sign bytes with a key held in memory, as the C2PA algorithm wants them:
 * ECDSA as the raw r‖s pair (not DER), RSA as PSS with a salt the length of
 * the digest, Ed25519 as it is.
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
