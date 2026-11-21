// The app's PNG text reads. The parsing is core's
// (packages/core/src/extraction/png-text.ts) and the file read core-node's;
// the app names itself as the reader, as before.
import { observePngText as observeWithCoreNode } from "@provenancetracker/core-node/extract/png-text.ts";
import { GENERATOR } from "../manifest/generator.js";

export {
	pngTextChunks,
	parseITxt,
} from "@provenancetracker/core/extraction/png-text.ts";

/**
 * The observation of a PNG's text chunks. A file that is not a PNG, or a
 * PNG with no text chunks, is `absent`.
 * @returns {Promise<import('@provenancetracker/core/extraction/observation.ts').Observation>}
 */
export async function observePngText(filePath) {
	return observeWithCoreNode(filePath, GENERATOR);
}

/**
 * Extract tEXt/iTXt chunks from a PNG file.
 * Returns a flat object of { keyword: value } pairs; {} when there are none
 * or the file is not a readable PNG.
 */
export async function extractPngChunks(filePath) {
	const obs = await observePngText(filePath);
	return obs.status === "ok" ? obs.data : {};
}
