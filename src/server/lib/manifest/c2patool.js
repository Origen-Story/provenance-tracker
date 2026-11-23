// The app's c2patool signing, until the app runs on the catalogs (Phase 6,
// slice 7). The engine itself is core-node's (sign/c2patool-sign.ts), shared
// with the catalog API; this wrapper gives it the app's c2patool and logger.
import {
	algorithmFor,
	readReport as readWith,
	signWithC2patool as signWith,
	storableDefinition,
} from "@provenancetracker/core-node/sign/c2patool-sign.ts";
import { resolveC2patoolPath } from "../extraction/c2pa.js";
import { createLogger } from "../logger.js";

const log = createLogger("c2patool");

export { algorithmFor, storableDefinition };

/**
 * The full c2patool report for a file, or null when it carries no manifest.
 * @param {string} filePath
 * @param {{ externalManifest?: string }} [opts]
 */
export function readReport(filePath, { externalManifest = "" } = {}) {
	return readWith(filePath, {
		tool: resolveC2patoolPath(),
		externalManifest,
	});
}

/**
 * Sign `inputPath` into `outputPath` with a definition from build.js.
 * @param {Omit<Parameters<typeof signWith>[0], "tool" | "log">} args
 */
export function signWithC2patool(args) {
	return signWith({
		...args,
		tool: resolveC2patoolPath(),
		log: (line) => log.info(line),
	});
}
