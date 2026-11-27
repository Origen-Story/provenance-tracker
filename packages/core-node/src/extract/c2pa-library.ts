// The C2PA library (@contentauth/c2pa-node): the reader of Content
// Credentials (D15, D51) and, by default, the signer (D53). It is the only
// reader allowed to judge camera files: c2patool's reading of camera video is
// wrong, and c2patool now only signs when a machine chooses it.
//
// The library's native binary is loaded only from the copy `npm run
// tools:fetch` installed (tools/c2pa-node/index.node), and only while its
// bytes are the ones pinned in tracked source and its version is the
// package's (D69); never from what the package's install script may have
// downloaded, and never from a path a setting names. Trust comes from the
// pinned C2PA trust lists (tools/trust-lists/), checked the same way and
// given as text, so nothing is fetched to load them: the signing list for
// claims, and the time-stamp list for time stamps.
// What the library may send out (docs/network.md): nothing when it reads.
// OCSP is off, the trust lists are given as text, it is handed a fetch that
// refuses, so it can never fetch a trust list, and its fetching of Content
// Credentials a file says are stored on the web is off for good (D74). For
// such a file it names the address and stops; the tracker fetches, when this
// machine's setting allows that host (web-credentials.ts), and hands the
// bytes back to be checked against the file, as it does for a .c2pa sidecar.
// Signing uses the same settings and the same fetch.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
	libraryObservation,
	type LibraryRun,
} from "@provenancetracker/core/extraction/c2pa-library-read.ts";
import type { Observation } from "@provenancetracker/core/extraction/observation.ts";
import {
	hostOfAddress,
	remoteAddressOf,
	type OnTheWeb,
} from "@provenancetracker/core/extraction/web-credentials.ts";
import type { Env } from "../machine.ts";
import { notPinned, pinOf, pinnedTrustLists } from "../pinned.ts";
import type { WebFetch } from "../web-credentials.ts";

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

/** What a file's credentials read as, and where they came from when not from the file. */
export interface StoreRead {
	/** The manifest store; null when the file has none. */
	store: LibraryRun["store"];
	/** Set when the file keeps its credentials on the web and they were fetched. */
	web?: { address: string; bytes: Buffer };
}

/** The file keeps its credentials on the web, and this machine does not have them. */
export class CredentialsNotFetched extends Error {
	readonly onTheWeb: OnTheWeb;
	constructor(onTheWeb: OnTheWeb) {
		super(`Content Credentials at ${onTheWeb.address} were not fetched`);
		this.onTheWeb = onTheWeb;
	}
}

export interface LibraryReader {
	version: string;
	/** Throws CredentialsNotFetched for credentials on the web it does not have. */
	read: (file: string, sidecar?: string) => Promise<StoreRead>;
}

/** The loaded library, its version, and the settings every reading and signing uses. */
export interface LoadedLibrary {
	lib: Lib;
	version: string;
	context: Context;
}

/**
 * The native binary to load: the pinned copy, and only while its bytes are
 * the ones recorded in tracked source for this kind of machine (D69). No
 * setting names another file: C2PA_LIBRARY_PATH, which the package itself
 * reads, is refused when it points anywhere else.
 * @param at for tests: the file, and the machine's kind
 * @returns the path and the version its hash is pinned for, or the reason there is none
 */
export function libraryBinary(
	env: Env,
	at: { file?: string; platform?: NodeJS.Platform; arch?: string } = {},
): { path: string; version: string } | { unavailable: string } {
	const file = at.file ?? PINNED_BINARY;
	if (
		env.C2PA_LIBRARY_PATH &&
		path.resolve(env.C2PA_LIBRARY_PATH) !== path.resolve(file)
	)
		return {
			unavailable:
				"C2PA_LIBRARY_PATH is set. The tracker loads only the C2PA library binary that npm run tools:fetch installed and checked, so take that setting out.",
		};
	const pin = pinOf("c2pa-node", at.platform, at.arch);
	if (!pin)
		return {
			unavailable: `The C2PA library has no pinned binary for ${at.platform ?? process.platform}-${at.arch ?? process.arch}, so it cannot be used on this machine.`,
		};
	const problem = notPinned(file, pin.sha256, "tools/c2pa-node/index.node");
	if (problem)
		return {
			unavailable: problem.replace(
				"tools/c2pa-node/index.node is not installed",
				"The C2PA library's native binary is not installed",
			),
		};
	return { path: file, version: pin.version };
}

/**
 * Why the library package and the pinned binary may not be used together;
 * null when they are the same release. A package bumped without its binary
 * would otherwise run the old binary and record the new version's name on
 * everything it read or signed.
 */
export function versionMismatch(
	packageVersion: string,
	binaryVersion: string,
): string | null {
	return packageVersion === binaryVersion
		? null
		: `The C2PA library package is ${packageVersion} and the binary in tools/ is the one pinned for ${binaryVersion}: they must be the same release. Run npm ci, then npm run tools:fetch -- --force.`;
}

/**
 * The settings every reading uses: the pinned trust list, no OCSP, and no
 * fetching of credentials a file keeps on the web (the tracker fetches those
 * itself, D74).
 */
export function readerSettings(
	trustAnchors: string,
	opts: { userAnchors?: string } = {},
) {
	return {
		trust: {
			trustAnchors,
			...(opts.userAnchors ? { userAnchors: opts.userAnchors } : {}),
		},
		verify: {
			verifyTrust: true,
			remoteManifestFetch: false,
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
 * @param opts.userAnchors certificates this machine also trusts, as PEM text:
 *   the library reports a file signed under one as trusted by a "User" anchor
 */
export function loadLibrary(
	env: Env,
	opts: { userAnchors?: string } = {},
): Promise<LoadedLibrary | { unavailable: string }> {
	const key = opts.userAnchors ?? "";
	const known = loaded.get(key);
	if (known) return known;
	const attempt = (async () => {
		// Checked before anything is loaded, each time a library is made ready:
		// the binary, the package it belongs to, and the two trust lists.
		const binary = libraryBinary(env);
		if ("unavailable" in binary) return binary;
		const version = (
			createRequire(import.meta.url)("@contentauth/c2pa-node/package.json") as {
				version: string;
			}
		).version;
		const mismatch = versionMismatch(version, binary.version);
		if (mismatch) return { unavailable: mismatch };
		const lists = pinnedTrustLists();
		for (const list of [TRUST_LIST, TSA_TRUST_LIST]) {
			const name = path.basename(list);
			const problem = notPinned(
				list,
				lists[name] ?? "",
				`The C2PA trust list tools/trust-lists/${name}`,
				"Run npm run tools:fetch.",
			);
			if (problem) return { unavailable: problem };
		}
		// The package finds its binary by this name: it is the tracker's to
		// set, to the copy just checked, whatever it was set to before.
		const chosen = process.env.C2PA_LIBRARY_PATH;
		if (chosen && path.resolve(chosen) !== path.resolve(binary.path))
			return {
				unavailable:
					"C2PA_LIBRARY_PATH is set. The tracker loads only the C2PA library binary that npm run tools:fetch installed and checked, so take that setting out.",
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

/**
 * Read one file, or a .c2pa sidecar against its file, with the loaded
 * library alone. A file that keeps its credentials on the web makes it throw,
 * naming the address: readWithWeb is the reading that follows it.
 */
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

/**
 * Read one file's own credentials: those inside it, or, when it carries only
 * an address for them, what `web` gives for that address, checked against the
 * file by the library exactly as a .c2pa sidecar is.
 * @throws CredentialsNotFetched when they are on the web and `web` did not
 *   give them, or gave something that is not Content Credentials
 */
export async function readWithWeb(
	loaded: LoadedLibrary,
	file: string,
	web: WebFetch,
): Promise<StoreRead> {
	try {
		return { store: await readStore(loaded, file) };
	} catch (err) {
		const address = remoteAddressOf(err as Error);
		if (!address) throw err;
		const got = await web(address);
		if ("onTheWeb" in got) throw new CredentialsNotFetched(got.onTheWeb);
		const { lib, context } = loaded;
		try {
			const reader = await lib.Reader.fromManifestDataAndAsset(
				got.bytes,
				{ path: file },
				context,
			);
			return {
				store: reader ? reader.json() : null,
				web: { address, bytes: got.bytes },
			};
		} catch (unread) {
			const at = hostOfAddress(address);
			throw new CredentialsNotFetched({
				address,
				host: "host" in at ? at.host : null,
				outcome: "failed",
				detail: `what the address returned could not be read as Content Credentials (${String((unread as Error).message).trim() || "unknown error"})`,
			});
		}
	}
}

/**
 * The library as a reader, for `extract`.
 * @param opts.web this machine's fetch for credentials a file keeps on the
 *   web (webCredentialsFor); tests give one that never reaches the network
 */
export async function loadLibraryReader(
	env: Env,
	opts: { web: WebFetch; userAnchors?: string },
): Promise<LibraryReader | { unavailable: string }> {
	const loaded = await loadLibrary(env, { userAnchors: opts.userAnchors });
	if ("unavailable" in loaded) return loaded;
	return {
		version: loaded.version,
		read: async (file, sidecar) =>
			sidecar
				? { store: await readStore(loaded, file, sidecar) }
				: readWithWeb(loaded, file, opts.web),
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
		const { store, web } = await reader.read(file, sidecar);
		return libraryObservation({
			kind,
			version: reader.version,
			store,
			fetchedFrom: web?.address,
		});
	} catch (err) {
		if (err instanceof CredentialsNotFetched)
			return libraryObservation({
				kind,
				version: reader.version,
				onTheWeb: err.onTheWeb,
			});
		return libraryObservation({
			kind,
			version: reader.version,
			error: err as Error,
		});
	}
}
