// The development certificate script (scripts/generate-dev-cert.mjs), on
// what it leaves on disk (D85): no key it has no more use for, nothing
// replaced, and nothing at all after a run that failed.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { haveOpenssl } from "./helpers/cert.ts";
import { machinesForTests } from "./helpers/machine.ts";

const { folder } = machinesForTests();
const SCRIPT = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"scripts",
	"generate-dev-cert.mjs",
);
const make = (dir: string, ...args: string[]) =>
	spawnSync(process.execPath, [SCRIPT, dir, ...args], { encoding: "utf8" });

describe.skipIf(!haveOpenssl)(
	"generate-dev-cert.mjs, what it leaves on disk",
	() => {
		it("deletes the made-up authority's key once it has issued the certificate", () => {
			const dir = path.join(folder("certs"), "out");
			const r = make(dir);
			expect(r.status, r.stderr).toBe(0);
			expect(readdirSync(dir).sort()).toEqual([
				"_ca-cert.pem",
				"c2pa-dev-cert.pem",
				"c2pa-dev-key.pem",
			]);
			expect(r.stdout).toContain("the authority's key was deleted");
			// The chain is the certificate and then the authority that issued it.
			expect(
				readFileSync(path.join(dir, "c2pa-dev-cert.pem"), "utf8").match(
					/BEGIN CERTIFICATE/g,
				),
			).toHaveLength(2);
		});

		it("keeps the authority's key only when asked, and says what that means", () => {
			const dir = path.join(folder("certs"), "out");
			const r = make(dir, "--keep-ca-key");
			expect(r.status, r.stderr).toBe(0);
			expect(readdirSync(dir)).toContain("_ca-key.pem");
			expect(r.stdout).toContain(
				"whoever holds it can issue more certificates",
			);
		});

		it.skipIf(process.platform === "win32")(
			"makes the private key readable by this person only",
			() => {
				const dir = path.join(folder("certs"), "out");
				expect(make(dir).status).toBe(0);
				expect(statSync(path.join(dir, "c2pa-dev-key.pem")).mode & 0o777).toBe(
					0o600,
				);
			},
		);

		it("replaces nothing that is already there, the authority's files included", () => {
			for (const existing of [
				"c2pa-dev-key.pem",
				"c2pa-dev-cert.pem",
				"_ca-key.pem",
				"_ca-cert.pem",
			]) {
				const dir = folder(`existing-${existing}`);
				writeFileSync(path.join(dir, existing), "kept");
				const r = make(dir);
				expect(r.status, existing).toBe(1);
				expect(r.stderr).toContain("Refusing to overwrite");
				// Checked before anything is written: only what was there is there.
				expect(readdirSync(dir)).toEqual([existing]);
				expect(readFileSync(path.join(dir, existing), "utf8")).toBe("kept");
			}
		});

		it("leaves no key and no certificate behind when a run fails part-way", () => {
			const dir = folder("fails");
			// A folder where the script writes the issued certificate: the authority
			// and both keys are made first, then issuing fails.
			mkdirSync(path.join(dir, "_signing-cert-only.pem"));
			const r = make(dir);
			expect(r.status).toBe(1);
			for (const made of [
				"_ca-key.pem",
				"_ca-cert.pem",
				"c2pa-dev-key.pem",
				"c2pa-dev-cert.pem",
			])
				expect(existsSync(path.join(dir, made)), made).toBe(false);
		});
	},
);
