// A throwaway signing certificate and key for a test, made by the dev-cert
// script into the test's own temp folder (never certs/). Null where openssl
// is missing, so a test can skip.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { findOpenssl } from "../../../scripts/lib/openssl.mjs";

/** openssl on this machine (on the path, or Git for Windows' copy), or null. */
export const OPENSSL = findOpenssl() as string | null;
export const haveOpenssl = OPENSSL !== null;

const SCRIPT = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"scripts",
	"generate-dev-cert.mjs",
);

export function devCertificate(
	dir: string,
	/** A person's name: an identity certificate in that name (D55). */
	name?: string,
): { certificate: string; privateKey: string } | null {
	if (!haveOpenssl) return null;
	const certDir = path.join(dir, name ? "test-identity" : "test-certs");
	const r = spawnSync(
		process.execPath,
		[SCRIPT, certDir, ...(name ? ["--name", name] : [])],
		{ encoding: "utf8" },
	);
	if (r.status !== 0)
		throw new Error(`certificate generation failed: ${r.stderr || r.stdout}`);
	return {
		certificate: path.join(certDir, "c2pa-dev-cert.pem"),
		privateKey: path.join(certDir, "c2pa-dev-key.pem"),
	};
}
