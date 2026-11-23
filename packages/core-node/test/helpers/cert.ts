// A throwaway signing certificate and key for a test, made by the dev-cert
// script into the test's own temp folder (never certs/). Null where openssl
// is missing, so a test can skip.

import { spawnSync } from "node:child_process";
import path from "node:path";

export const haveOpenssl =
	spawnSync("openssl", ["version"], { encoding: "utf8" }).status === 0;

const SCRIPT = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"scripts",
	"generate-dev-cert.mjs",
);

export function devCertificate(
	dir: string,
): { certificate: string; privateKey: string } | null {
	if (!haveOpenssl) return null;
	const certDir = path.join(dir, "test-certs");
	const r = spawnSync(process.execPath, [SCRIPT, certDir], {
		encoding: "utf8",
	});
	if (r.status !== 0)
		throw new Error(`certificate generation failed: ${r.stderr || r.stdout}`);
	return {
		certificate: path.join(certDir, "c2pa-dev-cert.pem"),
		privateKey: path.join(certDir, "c2pa-dev-key.pem"),
	};
}
