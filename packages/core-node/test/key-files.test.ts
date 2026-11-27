// The key files as a holder (D54, D85): what it says when a file cannot be
// read, that it never says where the files are, and that a certificate
// outside its dates does not sign. Certificates are throwaway ones made in
// the test's own temp folder.

import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { keyFilesHolder } from "../src/sign/holders/key-files.ts";
import { devCertificate, haveOpenssl } from "./helpers/cert.ts";
import { machinesForTests } from "./helpers/machine.ts";

const { folder } = machinesForTests();

describe.skipIf(!haveOpenssl)("keyFilesHolder", () => {
	const pair = (label: string) => {
		// A folder name a message would give away if it named the path.
		const dir = folder(`where-the-keys-are-${label}`);
		const cert = devCertificate(dir)!;
		return {
			dir,
			paths: {
				certificatePath: cert.certificate,
				privateKeyPath: cert.privateKey,
			},
		};
	};
	const messageOf = async (run: Promise<unknown>) => {
		try {
			await run;
		} catch (err) {
			return (err as Error).message;
		}
		throw new Error("it opened");
	};

	it("opens a current pair, and signs", async () => {
		const { paths } = pair("ok");
		const holder = await keyFilesHolder(paths);
		expect(holder.chain).toContain("BEGIN CERTIFICATE");
		expect((await holder.sign(Buffer.from("bytes"))).length).toBeGreaterThan(0);
	});

	it("says a file could not be read without saying where it is", async () => {
		const { dir, paths } = pair("unreadable");
		// A folder where a file should be: there, and not readable as a file.
		const notAFile = path.join(dir, "a-folder.pem");
		mkdirSync(notAFile);
		for (const [bad, words] of [
			[
				{ ...paths, certificatePath: notAFile },
				/certificate file could not be read \(E[A-Z]+\)/,
			],
			[
				{ ...paths, privateKeyPath: notAFile },
				/key file could not be read \(E[A-Z]+\)/,
			],
		] as const) {
			const message = await messageOf(keyFilesHolder(bad));
			expect(message).toMatch(words);
			expect(message).not.toContain("where-the-keys-are");
			expect(message).not.toContain(dir);
			expect(message).not.toContain("a-folder.pem");
		}
	});

	it("says a file is not a certificate or a key, without its path or its contents", async () => {
		const { dir, paths } = pair("garbled");
		const junk = path.join(dir, "junk.pem");
		writeFileSync(junk, "-----BEGIN NOTHING-----\nsecret-looking-text\n");
		for (const bad of [
			{ ...paths, certificatePath: junk },
			{ ...paths, privateKeyPath: junk },
		]) {
			const message = await messageOf(keyFilesHolder(bad));
			expect(message).toMatch(/does not read as a (certificate|private key)/);
			expect(message).not.toContain("where-the-keys-are");
			expect(message).not.toContain("secret-looking-text");
		}
	});

	it("does not sign with a certificate that has expired, or is not valid yet", async () => {
		const { paths } = pair("dates");
		// The throwaway certificate is valid for a year from now.
		const later = new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000);
		const expired = await messageOf(keyFilesHolder(paths, { now: later }));
		expect(expired).toMatch(
			/^The certificate expired on \d{4}-\d{2}-\d{2}\. A file signed with it now would read as invalid/,
		);
		const earlier = new Date(Date.now() - 2 * 24 * 3600 * 1000);
		const early = await messageOf(keyFilesHolder(paths, { now: earlier }));
		expect(early).toMatch(
			/^The certificate is not valid until \d{4}-\d{2}-\d{2}\./,
		);
		// On its dates it opens.
		await expect(
			keyFilesHolder(paths, { now: new Date() }),
		).resolves.toMatchObject({ kind: "key-files" });
	});

	it("leaves the key file as it was", async () => {
		const { paths } = pair("untouched");
		const before = readFileSync(paths.privateKeyPath);
		await keyFilesHolder(paths);
		expect(readFileSync(paths.privateKeyPath).equals(before)).toBe(true);
	});
});
