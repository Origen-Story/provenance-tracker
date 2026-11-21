// The app's ExifTool reads, through core-node's reader (one ExifTool process
// for the app and the command line; packages/core-node/src/extract/exiftool.ts).
import { createLogger } from "../logger.js";
import {
	readExif as readWithExifTool,
	endExifTool,
} from "@provenancetracker/core-node/extract/exiftool.ts";

const log = createLogger("exif");

/**
 * Read a file's EXIF, XMP, IPTC, container and PNG text metadata with
 * ExifTool, once.
 * @returns {Promise<{ tags: object|null, observation: import('@provenancetracker/core/extraction/observation.ts').Observation }>}
 *   `tags` is ExifTool's object as the current app uses it (null on failure);
 *   `observation` holds every tag except the location ones (observation.ts).
 */
export async function readExif(filePath) {
	const result = await readWithExifTool(filePath);
	if (result.observation.status !== "ok")
		log.error(`extraction failed for ${filePath}:`, result.observation.error);
	return result;
}

/** The observation of a file's metadata (see readExif). */
export async function observeExif(filePath) {
	return (await readExif(filePath)).observation;
}

/**
 * ExifTool's tags for a file, or null when the read failed.
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function extractExif(filePath) {
	return (await readExif(filePath)).tags;
}

export async function shutdownExifTool() {
	await endExifTool();
}
