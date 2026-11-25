// Which certificate and key sign a project's files on this machine (D41),
// and which identity certificate and key say who the creator is (D55): two
// separate pairs, set the same way. Paths only, in this machine's settings:
// never in a catalog, because a
// catalog travels and a key path is true on one machine. The public
// certificate is read (its name, issuer, fingerprint, expiry); the private
// key is only checked to be a file here; only its holder reads it, to sign.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { isFullPath } from "@provenancetracker/core/catalog/paths.ts";
import type { Machine } from "../machine.ts";
import { projectEntry, readSettings, updateSettings } from "../settings.ts";
import { certificateInfo } from "./certificates.ts";

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

/** The two key pairs a project can have on this machine. */
type Pair = "signing" | "identity";

const SETUP_HINT: Record<Pair, string> = {
	signing: "npm run cli -- signing --certificate <file> --key <file>",
	identity: "npm run cli -- identity --certificate <file> --key <file>",
};
const NONE: Record<Pair, string> = {
	signing: "No certificate and key are set for this project on this machine",
	identity:
		"No identity certificate and key are set for this project on this machine",
};

async function setPair(
	pair: Pair,
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
		projectEntry(s, projectId)[pair] = { certificate, privateKey };
	});
	return pairStatus(pair, machine, projectId);
}

function clearPair(pair: Pair, machine: Machine, projectId: string): void {
	updateSettings(machine.settingsPath, (s) => {
		delete projectEntry(s, projectId)[pair];
	});
}

async function pairStatus(
	pair: Pair,
	machine: Machine,
	projectId: string,
): Promise<SigningStatus> {
	const set = readSettings(machine.settingsPath).projects[projectId]?.[pair];
	if (!set)
		return { configured: false, problem: NONE[pair], certificate: null };
	let certificate: NonNullable<SigningStatus["certificate"]>;
	try {
		certificate = await certificateInfo(set.certificate);
	} catch {
		return {
			configured: true,
			problem: "The certificate file cannot be read",
			certificate: null,
		};
	}
	if (!existsSync(set.privateKey))
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

function pairPaths(
	pair: Pair,
	machine: Machine,
	projectId: string,
): { certificatePath: string; privateKeyPath: string } | null {
	const set = readSettings(machine.settingsPath).projects[projectId]?.[pair];
	return set
		? { certificatePath: set.certificate, privateKeyPath: set.privateKey }
		: null;
}

/**
 * Say which certificate and key sign this project here. The certificate must
 * read as one; the key must be a file, and not the certificate.
 */
export const setSigning = (
	machine: Machine,
	projectId: string,
	paths: { certificate: string; privateKey: string },
) => setPair("signing", machine, projectId, paths);

/** Forget this project's signing paths on this machine. */
export const clearSigning = (machine: Machine, projectId: string) =>
	clearPair("signing", machine, projectId);

/** Whether this project can be signed here, and with what certificate. */
export const signingStatus = (machine: Machine, projectId: string) =>
	pairStatus("signing", machine, projectId);

/** The paths to sign with, or why there are none. For signing only; never returned to a caller. */
export function signerPaths(
	machine: Machine,
	projectId: string,
): { certificatePath: string; privateKeyPath: string } {
	const paths = pairPaths("signing", machine, projectId);
	if (!paths)
		throw new Error(
			`This project has no certificate and key on this machine. Set them with: ${SETUP_HINT.signing}`,
		);
	return paths;
}

/**
 * Say which identity certificate and key say who signs this project's files
 * here (D55): a certificate issued to the creator, kept apart from the one
 * that signs the claim.
 */
export const setIdentity = (
	machine: Machine,
	projectId: string,
	paths: { certificate: string; privateKey: string },
) => setPair("identity", machine, projectId, paths);

/** Forget this project's identity paths on this machine; signing goes on without one. */
export const clearIdentity = (machine: Machine, projectId: string) =>
	clearPair("identity", machine, projectId);

/** Whether an identity is set up for this project here, and whose. */
export const identityStatus = (machine: Machine, projectId: string) =>
	pairStatus("identity", machine, projectId);

/** The identity's paths, or null when none is set up (it is optional). Never returned to a caller. */
export const identityPaths = (machine: Machine, projectId: string) =>
	pairPaths("identity", machine, projectId);
