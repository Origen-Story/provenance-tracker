// The C2PA library (@contentauth/c2pa-node): the reader of Content
// Credentials (D15, D51) and, by default, the signer (D53). It is the only
// reader allowed to judge camera files: c2patool's reading of camera video is
// wrong, and c2patool now only signs when a machine chooses it.
//
// The library's native binary is loaded only from the copy `npm run
// tools:fetch` pinned and checksummed (tools/c2pa-node/index.node), or from
// C2PA_LIBRARY_PATH when set; never from what the package's install script
// may have downloaded. Trust comes from the pinned C2PA trust lists
// (tools/trust-lists/), given as text, so nothing is fetched to load them:
// the signing list for claims, and the time-stamp list for time stamps.
// What reading may send out (docs/network.md): only a request for Content
// Credentials a file says are stored on the web (Adobe Firefly video), and
// only while this machine's setting allows it (on unless turned off). OCSP is
// off, the trust lists are given as text, and the library is handed a fetch
// that refuses, so it can never fetch a trust list. Signing uses the same
// settings, so the same switch covers ingredients read while signing.

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
export const TSA_TRUST_LIST = path.join(
	TOOLS,
	"trust-lists",
	"C2PA-TSA-TRUST-LIST.pem",
);

export type Lib = typeof import("@contentauth/c2pa-node");
type Context = InstanceType<Lib["Context"]>;

export interface LibraryReader {
	version: string;
	read: (file: string, sidecar?: string) => Promise<LibraryRun["store"]>;
}

/** The loaded library, its version, and the settings every reading and signing uses. */
export interface LoadedLibrary {
	lib: Lib;
	version: string;
	context: Context;
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

/**
 * The settings every reading uses: the pinned trust list, no OCSP, and
 * remote manifests fetched only when this machine allows it.
 */
export function readerSettings(
	trustAnchors: string,
	opts: { userAnchors?: string; remoteManifests: boolean },
) {
	return {
		trust: {
			trustAnchors,
			...(opts.userAnchors ? { userAnchors: opts.userAnchors } : {}),
		},
		verify: {
			verifyTrust: true,
			remoteManifestFetch: opts.remoteManifests,
			ocspFetch: false,
		},
	};
}

/**
 * Add the C2PA time-stamp list to settings the library has resolved, as its
 * own kind of trust anchor ("tsa"). The library's settings object maps only
 * claim anchors (`trust`) and identity anchors (`cawgTrust`), so without this
 * no time stamp can read as trusted, even one from a listed authority (found
 * 2026-11-25: the Pixel clip's Google time stamp then reads trusted).
 * @param wire the resolved settings, as the native library reads them
 * @returns the same settings with one more anchor entry
 */
export function withTimeStampAnchors(
	wire: Record<string, unknown>,
	tsaAnchors: string,
): Record<string, unknown> {
	const trust = (wire.trust ?? {}) as Record<string, unknown>;
	const anchors = Array.isArray(trust.anchors) ? trust.anchors : [];
	return {
		...wire,
		trust: {
			...trust,
			anchors: [
				...anchors,
				{
					trust_anchors: tsaAnchors,
					trust_uri: "tsa_system_anchors",
					trust_kind: "tsa",
				},
			],
		},
	};
}

const refuseNetwork = (): Promise<Response> => {
	throw new Error(
		"The tracker does not let the C2PA library fetch a trust list.",
	);
};

const loaded = new Map<
	string,
	Promise<LoadedLibrary | { unavailable: string }>
>();

/**
 * Load the library once per process (and once per set of options), with the
 * settings every reading and signing uses. Its binary path is read by the
 * library on first use, so it is set before the first import.
 * @param opts.remoteManifests fetch Content Credentials a file says are
 *   stored on the web (the machine's setting; tests pass false)
 * @param opts.userAnchors certificates this machine also trusts, as PEM text:
 *   the library reports a file signed under one as trusted by a "User" anchor
 */
export function loadLibrary(
	env: Env,
	opts: { remoteManifests: boolean; userAnchors?: string },
): Promise<LoadedLibrary | { unavailable: string }> {
	const key = `${env.C2PA_LIBRARY_PATH ?? ""}|${opts.remoteManifests}|${opts.userAnchors ?? ""}`;
	const known = loaded.get(key);
	if (known) return known;
	const attempt = (async () => {
		const binary = libraryBinary(env);
		if ("unavailable" in binary) return binary;
		for (const list of [TRUST_LIST, TSA_TRUST_LIST])
			if (!existsSync(list))
				return {
					unavailable: `The C2PA trust list ${path.basename(list)} is not installed. Run npm run tools:fetch.`,
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
		const tsaAnchors = readFileSync(TSA_TRUST_LIST, "utf8");
		// Still a Context, so the library keeps its own handling of it (and the
		// fetch that refuses); only the resolved settings gain the time-stamp list.
		class TrackerContext extends lib.Context {
			override async toJson(
				options?: Parameters<Context["toJson"]>[0],
			): Promise<string> {
				const wire = JSON.parse(await super.toJson(options)) as Record<
					string,
					unknown
				>;
				return JSON.stringify(withTimeStampAnchors(wire, tsaAnchors));
			}
		}
		const context = new TrackerContext(
			readerSettings(readFileSync(TRUST_LIST, "utf8"), opts),
			undefined,
			{ trustFetch: { fetch: refuseNetwork } },
		);
		return { lib, version, context };
	})();
	loaded.set(key, attempt);
	return attempt;
}

/** Read one file, or a .c2pa sidecar against its file, with the loaded library. */
export async function readStore(
	loaded: LoadedLibrary,
	file: string,
	sidecar?: string,
): Promise<LibraryRun["store"]> {
	const { lib, context } = loaded;
	const reader = sidecar
		? await lib.Reader.fromManifestDataAndAsset(
				await readFile(sidecar),
				{ path: file },
				context,
			)
		: await lib.Reader.fromAsset({ path: file }, context);
	return reader ? reader.json() : null;
}

/** The library as a reader, for `extract`. */
export async function loadLibraryReader(
	env: Env,
	opts: { remoteManifests: boolean; userAnchors?: string },
): Promise<LibraryReader | { unavailable: string }> {
	const loaded = await loadLibrary(env, opts);
	if ("unavailable" in loaded) return loaded;
	return {
		version: loaded.version,
		read: (file, sidecar) => readStore(loaded, file, sidecar),
	};
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
