// Which certificate and key sign a project's files on this machine (D41).
// Paths only, in this machine's settings: never in a catalog, because a
// catalog travels and a key path is true on one machine. The public
// certificate is read (its name, issuer, fingerprint, expiry); the private
// key is only checked to be a file, and is only ever passed to c2patool.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { isFullPath } from "@provenancetracker/core/catalog/paths.ts";
import type { Machine } from "../machine.ts";
import { projectEntry, readSettings, updateSettings } from "../settings.ts";
import { certificateInfo } from "./c2patool-sign.ts";

export interface SigningStatus {
	configured: boolean;
	/** Why signing cannot happen here now, when it cannot. */
	problem: string | null;
	/** What the certificate says, when it can be read. Never a path. */
	certificate: {
		commonName: string;
		issuer: string;
		fingerprint: string;
		validTo: string;
	} | null;
}

function checkFile(p: string, what: string, machine: Machine): string {
	if (!isFullPath(p, machine.platform))
		throw new Error(`The ${what} must be a full path`);
	if (!existsSync(p) || !statSync(p).isFile())
		throw new Error(`There is no ${what} file there`);
	return path.resolve(p);
}

/**
 * Say which certificate and key sign this project here. The certificate must
 * read as one; the key must be a file, and not the certificate.
 */
export async function setSigning(
	machine: Machine,
	projectId: string,
	paths: { certificate: string; privateKey: string },
): Promise<SigningStatus> {
	const certificate = checkFile(paths.certificate, "certificate", machine);
	const privateKey = checkFile(paths.privateKey, "private key", machine);
	if (certificate === privateKey)
		throw new Error("The certificate and the private key are the same file");
	try {
		await certificateInfo(certificate);
	} catch (err) {
		throw new Error(
			`The certificate file does not read as a certificate (PEM): ${(err as Error).message}`,
			{ cause: err },
		);
	}
	updateSettings(machine.settingsPath, (s) => {
		projectEntry(s, projectId).signing = { certificate, privateKey };
	});
	return signingStatus(machine, projectId);
}

/** Forget this project's signing paths on this machine. */
export function clearSigning(machine: Machine, projectId: string): void {
	updateSettings(machine.settingsPath, (s) => {
		delete projectEntry(s, projectId).signing;
	});
}

/** Whether this project can be signed here, and with what certificate. */
export async function signingStatus(
	machine: Machine,
	projectId: string,
): Promise<SigningStatus> {
	const signing = readSettings(machine.settingsPath).projects[projectId]
		?.signing;
	if (!signing)
		return {
			configured: false,
			problem:
				"No certificate and key are set for this project on this machine",
			certificate: null,
		};
	let certificate: NonNullable<SigningStatus["certificate"]>;
	try {
		certificate = await certificateInfo(signing.certificate);
	} catch {
		return {
			configured: true,
			problem: "The certificate file cannot be read",
			certificate: null,
		};
	}
	if (!existsSync(signing.privateKey))
		return {
			configured: true,
			problem: "The private key file is not there",
			certificate,
		};
	if (Date.parse(certificate.validTo) < Date.now())
		return {
			configured: true,
			problem: `The certificate expired on ${certificate.validTo.slice(0, 10)}`,
			certificate,
		};
	return { configured: true, problem: null, certificate };
}

/** The paths to sign with, or why there are none. For signing only; never returned to a caller. */
export function signerPaths(
	machine: Machine,
	projectId: string,
): { certificatePath: string; privateKeyPath: string } {
	const signing = readSettings(machine.settingsPath).projects[projectId]
		?.signing;
	if (!signing)
		throw new Error(
			"This project has no certificate and key on this machine. Set them with: npm run cli -- signing --certificate <file> --key <file>",
		);
	return {
		certificatePath: signing.certificate,
		privateKeyPath: signing.privateKey,
	};
}
