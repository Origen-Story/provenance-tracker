// c2patool, the pinned C2PA reader and signer (npm run tools:fetch). Reads a
// manifest store in a file, or a .c2pa sidecar checked against its file.
//
// Only the copy in tools/ is ever run, and only while its bytes are the
// pinned ones (D69): no setting names another program, and there is no
// falling back to a c2patool that happens to be on PATH.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
	c2patoolObservation,
	parseToolVersion,
} from "@provenancetracker/core/extraction/c2patool-read.ts";
import {
	makeObservation,
	type Observation,
} from "@provenancetracker/core/extraction/observation.ts";
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

/**
 * Read the C2PA manifest store of `file`, or, given `sidecar`, the .c2pa
 * file beside it, validated against `file`'s bytes.
 */
export async function readC2pa(
	file: string,
	opts: { tool: string; sidecar?: string },
): Promise<Observation> {
	const version = await c2patoolVersion(opts.tool);
	const args = opts.sidecar
		? ["--external-manifest", opts.sidecar, file]
		: [file];
	let observation: Observation;
	try {
		const { stdout } = await execFileP(opts.tool, args, {
			maxBuffer: 64 * 1024 * 1024,
			timeout: 60000,
		});
		observation = c2patoolObservation({ stdout, version });
	} catch (err) {
		observation = c2patoolObservation({
			err: err as { code?: string; stderr?: string; message?: string },
			version,
		});
	}
	if (!opts.sidecar) return observation;
	// The same reading, recorded as the sidecar's.
	return makeObservation({
		kind: "c2pa-sidecar",
		extractor: observation.extractor,
		version: observation.version,
		status: observation.status,
		data: observation.data,
		error: observation.error,
		warnings: observation.warnings,
		validation: observation.validation,
	});
}
