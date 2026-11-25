// A credential holder that keeps its key in memory and has no key files: the
// kind of holder a keychain, a hardware token or a remote signer would be
// (D54). It proves the signing seam takes something other than key files.

import { createPrivateKey } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { algorithmOf } from "../../src/sign/certificates.ts";
import { signBytes, type CredentialHolder } from "../../src/sign/holder.ts";

/**
 * Read a throwaway certificate and key into memory, then delete the key file,
 * so nothing can sign from the file afterwards.
 */
export function memoryHolder(cert: {
	certificate: string;
	privateKey: string;
}): CredentialHolder {
	const chain = readFileSync(cert.certificate, "utf8");
	const key = createPrivateKey(readFileSync(cert.privateKey));
	rmSync(cert.privateKey);
	const alg = algorithmOf(chain);
	return {
		kind: "memory",
		chain,
		alg,
		sign: async (data) => signBytes(alg, key, data),
	};
}
