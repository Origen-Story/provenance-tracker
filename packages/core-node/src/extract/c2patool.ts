// c2patool, the pinned signer a machine can choose (npm run tools:fetch):
// where it is, whether it is the pinned program, and its version. It no
// longer reads files for the catalog: the C2PA library does (D15, D51).
//
// Only the copy in tools/ is ever run, and only while its bytes are the
// pinned ones (D69): no setting names another program, and there is no
// falling back to a c2patool that happens to be on PATH.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { parseToolVersion } from "@provenancetracker/core/extraction/c2patool-read.ts";
import type { Env } from "../machine.ts";
import { notPinned, pinOf } from "../pinned.ts";

const execFileP = promisify(execFile);

/** The repository's tools/ folder, from this file (packages/core-node/src/extract/). */
const TOOLS = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"tools",
);

/**
 * Where c2patool is: the copy `npm run tools:fetch` installed, and nowhere
 * else. The environment is not consulted (C2PATOOL_PATH named another
 * program until D69).
 */
export function c2patoolPath(
	_env: Env,
	platform: NodeJS.Platform = process.platform,
): string {
	return path.join(
		TOOLS,
		"c2patool",
		platform === "win32" ? "c2patool.exe" : "c2patool",
	);
}

/**
 * Why c2patool may not be run on this machine, in words; null when the file
 * in tools/ is the pinned program, byte for byte. Asked before it is run.
 */
export function c2patoolProblem(
	env: Env,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): string | null {
	if (env.C2PATOOL_PATH)
		return "C2PATOOL_PATH is set. The tracker runs only the c2patool that npm run tools:fetch installed and checked, so take that setting out.";
	const pin = pinOf("c2patool", platform, arch);
	if (!pin)
		return `c2patool has no pinned download for ${platform}-${arch}, so it cannot be used on this machine. Sign with the C2PA library: npm run cli -- settings signing-engine library`;
	return notPinned(
		c2patoolPath(env, platform),
		pin.sha256,
		`tools/c2patool/${platform === "win32" ? "c2patool.exe" : "c2patool"}`,
	);
}

const versions = new Map<string, string>();

/** The version of the c2patool at `tool`, or null when it cannot run. Not cached when null. */
export async function c2patoolVersion(tool: string): Promise<string | null> {
	const known = versions.get(tool);
	if (known) return known;
	try {
		const { stdout } = await execFileP(tool, ["--version"], { timeout: 15000 });
		const v = parseToolVersion(stdout);
		if (v) versions.set(tool, v);
		return v;
	} catch {
		return null;
	}
}
