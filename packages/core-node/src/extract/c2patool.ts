// c2patool, the pinned C2PA reader and signer (npm run tools:fetch). Reads a
// manifest store in a file, or a .c2pa sidecar checked against its file.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
 * Which c2patool to run: C2PATOOL_PATH when set, the pinned one in tools/
 * when fetched, else `c2patool` on PATH (which may not exist).
 */
export function c2patoolPath(
	env: Env,
	platform: NodeJS.Platform = process.platform,
): string {
	if (env.C2PATOOL_PATH) return env.C2PATOOL_PATH;
	const pinned = path.join(
		TOOLS,
		"c2patool",
		platform === "win32" ? "c2patool.exe" : "c2patool",
	);
	return existsSync(pinned) ? pinned : "c2patool";
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
