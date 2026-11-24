// The C2PA library (@contentauth/c2pa-node) as the reader of Content
// Credentials (D15, D51). It is the only reader allowed to judge camera files:
// c2patool still signs, but its reading of camera video is wrong.
//
// The library's native binary is loaded only from the copy `npm run
// tools:fetch` pinned and checksummed (tools/c2pa-node/index.node), or from
// C2PA_LIBRARY_PATH when set; never from what the package's install script
// may have downloaded. Trust comes from the pinned C2PA trust list
// (tools/trust-lists/), given as text, so nothing is fetched to load it.
// Reading never goes online: remote manifests are not fetched, OCSP is off,
// and the library is handed a fetch that refuses (docs/network.md).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
	libraryObservation,
	type LibraryRun,
} from "@provenancetracker/core/extraction/c2pa-library-read.ts";
import type { Observation } from "@provenancetracker/core/extraction/observation.ts";
import type { Env } from "../machine.ts";

/** The repository's tools/ folder, from this file (packages/core-node/src/extract/). */
const TOOLS = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"tools",
);

export const PINNED_BINARY = path.join(TOOLS, "c2pa-node", "index.node");
export const TRUST_LIST = path.join(
	TOOLS,
	"trust-lists",
	"C2PA-TRUST-LIST.pem",
);

type Lib = typeof import("@contentauth/c2pa-node");

export interface LibraryReader {
	version: string;
	read: (file: string, sidecar?: string) => Promise<LibraryRun["store"]>;
}

/**
 * Which native binary to load: C2PA_LIBRARY_PATH when set, else the pinned
 * copy, which must still have the hash recorded when it was installed.
 * @returns the path, or the reason there is none
 */
export function libraryBinary(
	env: Env,
): { path: string } | { unavailable: string } {
	if (env.C2PA_LIBRARY_PATH) return { path: env.C2PA_LIBRARY_PATH };
	if (!existsSync(PINNED_BINARY))
		return {
			unavailable:
				"The C2PA library's native binary is not installed. Run npm run tools:fetch.",
		};
	const marker = `${PINNED_BINARY}.pinned.json`;
	try {
		const { sha256 } = JSON.parse(readFileSync(marker, "utf8")) as {
			sha256?: string;
		};
		const actual = createHash("sha256")
			.update(readFileSync(PINNED_BINARY))
			.digest("hex");
		if (actual !== sha256)
			return {
				unavailable:
					"tools/c2pa-node/index.node has changed since tools:fetch installed it. Run npm run tools:fetch -- --force.",
			};
	} catch {
		return {
			unavailable:
				"tools/c2pa-node/index.node has no install record. Run npm run tools:fetch -- --force.",
		};
	}
	return { path: PINNED_BINARY };
}

/** The settings every reading uses: the pinned trust list, nothing fetched. */
export function readerSettings(trustAnchors: string, userAnchors?: string) {
	return {
		trust: {
			trustAnchors,
			...(userAnchors ? { userAnchors } : {}),
		},
		verify: {
			verifyTrust: true,
			remoteManifestFetch: false,
			ocspFetch: false,
		},
	};
}

const refuseNetwork = (): Promise<Response> => {
	throw new Error(
		"The tracker does not let the C2PA library fetch anything while reading.",
	);
};

const loaded = new Map<
	string,
	Promise<LibraryReader | { unavailable: string }>
>();

/**
 * Load the library once per process (and once per set of extra anchors).
 * Its binary path is read by the library on first use, so it is set before
 * the first import.
 * @param opts.userAnchors certificates this machine also trusts, as PEM text:
 *   the library reports a file signed under one as trusted by a "User" anchor
 */
export function loadLibraryReader(
	env: Env,
	opts: { userAnchors?: string } = {},
): Promise<LibraryReader | { unavailable: string }> {
	const key = opts.userAnchors ?? "";
	const known = loaded.get(key);
	if (known) return known;
	const attempt = (async () => {
		const binary = libraryBinary(env);
		if ("unavailable" in binary) return binary;
		if (!existsSync(TRUST_LIST))
			return {
				unavailable:
					"The C2PA trust list is not installed. Run npm run tools:fetch.",
			};
		const chosen = process.env.C2PA_LIBRARY_PATH;
		if (chosen && path.resolve(chosen) !== path.resolve(binary.path))
			return {
				unavailable: `C2PA_LIBRARY_PATH already names ${chosen} in this process; it cannot also load ${binary.path}.`,
			};
		process.env.C2PA_LIBRARY_PATH = binary.path;
		let lib: Lib;
		try {
			lib = await import("@contentauth/c2pa-node");
		} catch (err) {
			return {
				unavailable: `The C2PA library could not be loaded: ${(err as Error).message}`,
			};
		}
		const version = (
			createRequire(import.meta.url)("@contentauth/c2pa-node/package.json") as {
				version: string;
			}
		).version;
		const context = new lib.Context(
			readerSettings(readFileSync(TRUST_LIST, "utf8"), opts.userAnchors),
			undefined,
			{ trustFetch: { fetch: refuseNetwork } },
		);
		return {
			version,
			read: async (file: string, sidecar?: string) => {
				const reader = sidecar
					? await lib.Reader.fromManifestDataAndAsset(
							await readFile(sidecar),
							{ path: file },
							context,
						)
					: await lib.Reader.fromAsset({ path: file }, context);
				return reader ? reader.json() : null;
			},
		};
	})();
	loaded.set(key, attempt);
	return attempt;
}

/** Read one file (or a .c2pa sidecar against its file) as an observation. */
export async function readC2paWithLibrary(
	reader: LibraryReader | { unavailable: string },
	file: string,
	sidecar?: string,
): Promise<Observation> {
	const kind = sidecar ? "c2pa-sidecar" : "c2pa";
	if ("unavailable" in reader)
		return libraryObservation({
			kind,
			version: null,
			unavailable: reader.unavailable,
		});
	try {
		const store = await reader.read(file, sidecar);
		return libraryObservation({ kind, version: reader.version, store });
	} catch (err) {
		return libraryObservation({
			kind,
			version: reader.version,
			error: err as Error,
		});
	}
}
