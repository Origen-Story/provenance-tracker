// What a signing certificate says, read from the public certificate only:
// the algorithm its key signs with, and who it names. Shared by every engine
// and by the signing settings (D41, D53). The private key is never read here.

import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";

/** The C2PA signing algorithms the tracker signs with. */
export type SigningAlg = "es256" | "es384" | "es512" | "ps256" | "ed25519";

/**
 * The signing algorithm follows the certificate's key: P-256 is es256 and so
 * on. Read from the public certificate, never from the private key.
 */
export async function algorithmFor(
	certificatePath: string,
): Promise<SigningAlg> {
	const key = new X509Certificate(await readFile(certificatePath, "utf8"))
		.publicKey;
	const type = key.asymmetricKeyType;
	if (type === "ec") {
		const curve = key.asymmetricKeyDetails?.namedCurve;
		if (curve === "prime256v1" || curve === "P-256") return "es256";
		if (curve === "secp384r1" || curve === "P-384") return "es384";
		if (curve === "secp521r1" || curve === "P-521") return "es512";
	}
	if (type === "rsa-pss" || type === "rsa") return "ps256";
	if (type === "ed25519") return "ed25519";
	throw new Error(`Unsupported signing key type in the certificate: ${type}`);
}

/**
 * What a public certificate says about whoever signs with it: its subject's
 * common name and its SHA-256 fingerprint (lower-case hex of the DER bytes),
 * the record of which certificate signed. The first certificate of a chain
 * is the signer's.
 */
export async function certificateInfo(certificatePath: string): Promise<{
	commonName: string;
	issuer: string;
	fingerprint: string;
	validTo: string;
}> {
	const pem = await readFile(certificatePath, "utf8");
	const cert = new X509Certificate(pem);
	const cn = (dn: string) =>
		/(?:^|\n)CN=([^\n]*)/.exec(dn)?.[1]?.trim() ?? dn.trim();
	return {
		commonName: cn(cert.subject),
		issuer: cn(cert.issuer),
		fingerprint: cert.fingerprint256.replaceAll(":", "").toLowerCase(),
		validTo: new Date(cert.validTo).toISOString(),
	};
}
