#!/usr/bin/env node
// Generate a two-step certificate chain for C2PA signing:
//   1. A self-signed dev root CA
//   2. A signing cert issued by that CA
//
// The output `c2pa-dev-cert.pem` is the PEM chain (signing cert + CA) that
// c2pa-node wants. `c2pa-dev-key.pem` is the signing private key.
//
// Why a chain and not just a self-signed end-entity cert: c2pa-rs's cert
// profile validator rejects certs whose issuer equals their subject on an
// end-entity cert. A proper chain (even a trivially-rooted one) satisfies it.
//
// Usage:  node scripts/generate-dev-cert.mjs [output-dir] [--key-type <type>]
//         (output-dir defaults to ./certs; the key type to es256, a P-256 key.
//         The others: es384 (P-384), ps256 (RSA 2048, signed with RSA-PSS) and
//         ed25519. Every type the tracker signs with is tested with these.)
//
// The cert is self-issued so signatures won't show "trusted publisher" on
// contentcredentials.org. Creator trust comes from the CAWG identity
// assertion, not the cert chain. For production use a CA-issued cert.
//
// Requires `openssl` on PATH. On Windows, Git for Windows installs it to
// C:\Program Files\Git\usr\bin\openssl.exe (Git Bash picks it up).

import { execFileSync } from "child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from "fs";
import path from "path";

const KEY_TYPES = {
	// SEC1 EC keys ("BEGIN EC PRIVATE KEY"), as openssl's ecparam writes them.
	es256: ["ecparam", "-genkey", "-name", "prime256v1", "-noout"],
	es384: ["ecparam", "-genkey", "-name", "secp384r1", "-noout"],
	ps256: ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"],
	ed25519: ["genpkey", "-algorithm", "ED25519"],
};
const args = process.argv.slice(2);
const typeAt = args.indexOf("--key-type");
const keyType = typeAt >= 0 ? args[typeAt + 1] : "es256";
if (!KEY_TYPES[keyType]) {
	console.error(
		`Unknown key type "${keyType}". Use one of: ${Object.keys(KEY_TYPES).join(", ")}`,
	);
	process.exit(1);
}
const positional =
	typeAt < 0 ? args : args.filter((a, i) => i !== typeAt && i !== typeAt + 1);
const outDir = path.resolve(positional[0] || "certs");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const caKeyPath = path.join(outDir, "_ca-key.pem");
const caCertPath = path.join(outDir, "_ca-cert.pem");
const signingKeyPath = path.join(outDir, "c2pa-dev-key.pem");
const signingCsrPath = path.join(outDir, "_signing.csr");
const signingCertOnlyPath = path.join(outDir, "_signing-cert-only.pem");
const chainPath = path.join(outDir, "c2pa-dev-cert.pem");

for (const p of [signingKeyPath, chainPath]) {
	if (existsSync(p)) {
		console.error(
			`Refusing to overwrite existing ${p}. Delete it first if you want to regenerate.`,
		);
		process.exit(1);
	}
}

// c2pa-rs cert profile requirements:
//   basicConstraints CA:FALSE (end-entity)
//   keyUsage: digitalSignature + nonRepudiation
//   extendedKeyUsage: emailProtection
//   authorityKeyIdentifier: named, not left to the openssl in use. OpenSSL 3
//     adds it unasked; LibreSSL (macOS's openssl) does not, and c2patool
//     then refuses the certificate as invalid (found by CI on macOS).
//   must be issued by another cert, not self-signed at the leaf level
const caCnfPath = path.join(outDir, "_ca.cnf");
writeFileSync(
	caCnfPath,
	`[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = Origen Story Dev Root CA
O = Origen Story
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
`,
);

const signingCnfPath = path.join(outDir, "_signing.cnf");
writeFileSync(
	signingCnfPath,
	`[req]
distinguished_name = dn
prompt = no
[dn]
CN = Origen Story Dev Signing Cert
O = Origen Story
[v3_ee]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, nonRepudiation
extendedKeyUsage = critical, emailProtection
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
`,
);

function run(cmd, args) {
	try {
		execFileSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
	} catch (err) {
		const stderr = err.stderr?.toString() ?? "";
		throw new Error(
			`${cmd} ${args.join(" ")} failed: ${stderr.trim() || `exit ${err.status}`}`,
			{ cause: err },
		);
	}
}

try {
	// 1. CA key + self-signed CA cert
	run("openssl", [
		"ecparam",
		"-genkey",
		"-name",
		"prime256v1",
		"-noout",
		"-out",
		caKeyPath,
	]);
	run("openssl", [
		"req",
		"-new",
		"-x509",
		"-key",
		caKeyPath,
		"-out",
		caCertPath,
		"-days",
		"3650",
		"-config",
		caCnfPath,
	]);

	// 2. Signing key + CSR
	run("openssl", [...KEY_TYPES[keyType], "-out", signingKeyPath]);
	run("openssl", [
		"req",
		"-new",
		"-key",
		signingKeyPath,
		"-out",
		signingCsrPath,
		"-config",
		signingCnfPath,
	]);

	// 3. CA signs the CSR to produce the end-entity signing cert
	run("openssl", [
		"x509",
		"-req",
		"-in",
		signingCsrPath,
		"-CA",
		caCertPath,
		"-CAkey",
		caKeyPath,
		"-CAcreateserial",
		"-out",
		signingCertOnlyPath,
		"-days",
		"365",
		"-extfile",
		signingCnfPath,
		"-extensions",
		"v3_ee",
	]);

	// 4. Build the chain PEM that c2pa-node consumes
	const signingPem = readFileSync(signingCertOnlyPath, "utf8");
	const caPem = readFileSync(caCertPath, "utf8");
	writeFileSync(chainPath, signingPem.trimEnd() + "\n" + caPem);
} catch (err) {
	console.error(`\n${err.message}`);
	console.error(`\nMake sure 'openssl' is on your PATH.`);
	console.error(
		`On Windows, Git for Windows includes it at C:\\Program Files\\Git\\usr\\bin\\openssl.exe`,
	);
	for (const tmp of [
		caCnfPath,
		signingCnfPath,
		signingCsrPath,
		signingCertOnlyPath,
	])
		rmSync(tmp, { force: true });
	process.exit(1);
}

for (const tmp of [
	caCnfPath,
	signingCnfPath,
	signingCsrPath,
	signingCertOnlyPath,
	path.join(outDir, "_ca-cert.srl"),
])
	rmSync(tmp, { force: true });

console.log(`\n✓ Dev cert chain generated at ${outDir}:`);
console.log(
	`  chain: ${chainPath}   (signing cert + CA cert — point certificate_path here)`,
);
console.log(
	`  key:   ${signingKeyPath}   (signing private key — point private_key_path here)`,
);
console.log(
	`  (_ca-cert.pem and _ca-key.pem are the dev root; keep them for re-issuing more certs)\n`,
);
console.log(
	`Use them for a project on its Settings page, or with: npm run cli -- signing --certificate <chain> --key <key>`,
);
console.log();
console.log(
	`This cert is self-issued — fine for local dev and demos. Creator trust`,
);
console.log(`comes from the CAWG identity assertion, not the cert chain.`);
