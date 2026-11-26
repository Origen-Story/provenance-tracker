// Is a file on disk the pinned one? (D69)
//
// The tracker loads one native library and may run one helper program, both
// installed under tools/ by `npm run tools:fetch`. Checking the download on
// the day it was installed is not enough: whatever sits at that path later is
// what gets loaded into the process that holds the signing key. So each is
// compared, every time, with the SHA-256 kept in tracked source
// (scripts/lib/pinned-tools.mjs), and nothing else is loaded or run: there is
// no setting that names another file, and no fallback to whatever is on PATH.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { DATA, pinnedBinary } from "../../../scripts/lib/pinned-tools.mjs";

export type PinnedTool = "c2pa-node" | "c2patool";

/** A tool's pinned version and its file's SHA-256 on this kind of machine; null where there is no pinned download. */
export function pinOf(
	name: PinnedTool,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): { version: string; sha256: string } | null {
	return pinnedBinary(name, platform, arch) as {
		version: string;
		sha256: string;
	} | null;
}

/** The pinned SHA-256 of each trust list, by file name. */
export function pinnedTrustLists(): Record<string, string> {
	return DATA["trust-lists"].files;
}

// A file is hashed once for as long as its size and time stay the same: the
// library is tens of megabytes, and it is asked about on every reading.
const seen = new Map<string, { stamp: string; sha256: string }>();

function sha256Of(file: string): string {
	const s = statSync(file);
	const stamp = `${s.size}/${s.mtimeMs}`;
	const known = seen.get(file);
	if (known?.stamp === stamp) return known.sha256;
	const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
	seen.set(file, { stamp, sha256 });
	return sha256;
}

/**
 * Why a file may not be used as the pinned one, in words; null when its
 * bytes are exactly the pinned ones.
 * @param what how to name it to a person ("tools/c2pa-node/index.node")
 * @param fix what to run to put it right
 */
export function notPinned(
	file: string,
	sha256: string,
	what: string,
	fix = "Run npm run tools:fetch -- --force.",
): string | null {
	if (!existsSync(file))
		return `${what} is not installed. Run npm run tools:fetch.`;
	let actual: string;
	try {
		actual = sha256Of(file);
	} catch (err) {
		return `${what} could not be read (${(err as NodeJS.ErrnoException).code ?? "error"}). ${fix}`;
	}
	return actual === sha256
		? null
		: `${what} is not the pinned copy: its bytes are not the ones recorded in scripts/lib/pinned-tools.mjs, so it is not loaded. ${fix}`;
}
