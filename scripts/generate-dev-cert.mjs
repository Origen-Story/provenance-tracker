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
//                [--name <subject name>] [--org <organisation>]
//         (output-dir defaults to ./certs; the key type to es256, a P-256 key.
//         The others: es384 (P-384), ps256 (RSA 2048, signed with RSA-PSS) and
//         ed25519. Every type the tracker signs with is tested with these.
//         --name makes it a test identity certificate in that name, for
//         `npm run cli -- identity`, D55; it needs the output folder.
//         Without --name the certificate is called "Provenance Tracker
//         development certificate <tag>", and without --org its organisation
//         reads "Unverified, self-issued <tag>". Each run has a tag of its
//         own, so no two certificates read the same, D67.)
//
// The cert is self-issued so signatures won't show "trusted publisher" on
// contentcredentials.org. Creator trust comes from the CAWG identity
// assertion, not the cert chain. For production use a CA-issued cert.
//
// Requires openssl: on PATH, or on Windows the copy Git for Windows installs
// (C:\Program Files\Git\usr\bin\openssl.exe), found from any shell.

import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import {
	chmodSync,
	mkdirSync,
	existsSync,
	writeFileSync,
	readFileSync,
	rmSync,
} from "fs";
import path from "path";
import { findOpenssl, OPENSSL_MISSING } from "./lib/openssl.mjs";

const KEY_TYPES = {
	// SEC1 EC keys ("BEGIN EC PRIVATE KEY"), as openssl's ecparam writes them.
	es256: ["ecparam", "-genkey", "-name", "prime256v1", "-noout"],
	es384: ["ecparam", "-genkey", "-name", "secp384r1", "-noout"],
	ps256: ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"],
	ed25519: ["genpkey", "-algorithm", "ED25519"],
};
// Options: --key-type <type>, --name <subject name>, --org <organisation>,
// and --keep-ca-key.
// A name or organisation goes into an openssl config file, so it is held to
// letters, digits, spaces and simple punctuation, and cannot start a new line.
const SAFE = /^[\p{L}\p{N} .,'()&-]{1,64}$/u;
const opts = { "--key-type": "es256", "--name": "", "--org": "" };
// The made-up authority's key is deleted once it has issued the one
// certificate: whoever holds it can issue more in the same authority's name,
// and this script never uses it again. --keep-ca-key leaves it, unencrypted,
// for someone who means to issue more by hand.
let keepCaKey = false;
const positional = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--keep-ca-key") {
		keepCaKey = true;
		continue;
	}
	if (args[i] in opts) {
		opts[args[i]] = args[++i] ?? "";
		continue;
	}
	positional.push(args[i]);
}
const keyType = opts["--key-type"];
if (!KEY_TYPES[keyType]) {
	console.error(
		`Unknown key type "${keyType}". Use one of: ${Object.keys(KEY_TYPES).join(", ")}`,
	);
	process.exit(1);
}
for (const o of ["--name", "--org"])
	if (opts[o] && !SAFE.test(opts[o])) {
		console.error(
			`${o} takes up to 64 letters, digits, spaces and . , ' ( ) & -`,
		);
		process.exit(1);
	}
// Something no other run has, in the names of what this run makes (D67). Two
// people who use the defaults must not end up with certificates that read
// the same: a name is all a reader shows, and all a person compares.
const tag = randomBytes(4).toString("hex");
// The signer's name: a person's, for an identity certificate (D55), or the
// development signing certificate's.
const subjectName =
	opts["--name"] || `Provenance Tracker development certificate ${tag}`;
// A certificate nobody checked says so in the organisation a reader shows
// beside it, unless the person gives one of their own. It is never put under
// an organisation they did not name: these defaults are the same for
// everyone who runs the tool, so they name nobody.
const organisation = opts["--org"] || `Unverified, self-issued ${tag}`;
// An identity certificate (--name) always names its folder: the default,
// certs/, holds the signing pair under the same file names (2026-11-25).
if (opts["--name"] && !positional[0]) {
	console.error(
		`--name makes an identity certificate, so say which folder it goes in, for example:\n  npm run cert:generate -- --name "${opts["--name"]}" "C:\\Certificates\\identity"\nIt never goes in certs/, where the signing certificate and key are.`,
	);
	process.exit(1);
}
const outDir = path.resolve(positional[0] || "certs");
const OPENSSL = findOpenssl();
if (!OPENSSL) {
	console.error(OPENSSL_MISSING);
	process.exit(1);
}
// Said before anything is made, so a name split by the shell shows at once.
console.log(
	`Making a certificate (${keyType}) for "${subjectName}" (${organisation}) in ${outDir}`,
);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const caKeyPath = path.join(outDir, "_ca-key.pem");
const caCertPath = path.join(outDir, "_ca-cert.pem");
const signingKeyPath = path.join(outDir, "c2pa-dev-key.pem");
const signingCsrPath = path.join(outDir, "_signing.csr");
const signingCertOnlyPath = path.join(outDir, "_signing-cert-only.pem");
const chainPath = path.join(outDir, "c2pa-dev-cert.pem");

// Everything this run would write is checked before anything is written:
// a key or a certificate already there is never replaced, the authority's
// included.
for (const p of [signingKeyPath, chainPath, caKeyPath, caCertPath]) {
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
CN = Provenance Tracker development root ${tag}
O = "${organisation}"
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
utf8 = yes
string_mask = utf8only
[dn]
CN = "${subjectName}"
O = "${organisation}"
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
		const why =
			err.code === "ENOENT"
				? OPENSSL_MISSING
				: stderr.trim() || `exit ${err.status ?? err.code}`;
		throw new Error(`${path.basename(cmd)} ${args.join(" ")} failed: ${why}`, {
			cause: err,
		});
	}
}

try {
	// 1. CA key + self-signed CA cert
	run(OPENSSL, [
		"ecparam",
		"-genkey",
		"-name",
		"prime256v1",
		"-noout",
		"-out",
		caKeyPath,
	]);
	run(OPENSSL, [
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
	run(OPENSSL, [...KEY_TYPES[keyType], "-out", signingKeyPath]);
	run(OPENSSL, [
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
	run(OPENSSL, [
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
	// A run that failed leaves nothing: no key without its certificate. None
	// of these was there before (checked above), so all are this run's.
	for (const made of [
		caKeyPath,
		signingKeyPath,
		caCertPath,
		chainPath,
		caCnfPath,
		signingCnfPath,
		signingCsrPath,
		signingCertOnlyPath,
		path.join(outDir, "_ca-cert.srl"),
	]) {
		try {
			rmSync(made, { force: true });
		} catch {
			// One that cannot be removed does not stop the rest being removed.
		}
	}
	process.exit(1);
}

for (const tmp of [
	caCnfPath,
	signingCnfPath,
	signingCsrPath,
	signingCertOnlyPath,
	path.join(outDir, "_ca-cert.srl"),
	...(keepCaKey ? [] : [caKeyPath]),
])
	rmSync(tmp, { force: true });
// The private keys are this person's only, where the system has such a thing.
for (const key of [signingKeyPath, ...(keepCaKey ? [caKeyPath] : [])])
	chmodSync(key, 0o600);

console.log(`\n✓ Dev cert chain generated at ${outDir}:`);
console.log(
	`  chain: ${chainPath}   (signing cert + CA cert — point certificate_path here)`,
);
console.log(
	`  key:   ${signingKeyPath}   (signing private key — point private_key_path here)`,
);
console.log(
	keepCaKey
		? `  (_ca-cert.pem and _ca-key.pem are the made-up authority; its key is unencrypted, and whoever holds it can issue more certificates in its name)\n`
		: `  (_ca-cert.pem is the made-up authority that issued it; the authority's key was deleted, so nothing more can be issued in its name)\n`,
);
console.log(
	`Use them for a project on its Settings page, or with: npm run cli -- signing --certificate <chain> --key <key>`,
);
console.log();
console.log(
	`This cert is self-issued — fine for local dev and demos. Creator trust`,
);
console.log(`comes from the CAWG identity assertion, not the cert chain.`);
