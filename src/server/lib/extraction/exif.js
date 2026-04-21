import { ExifTool } from 'exiftool-vendored';
import { createLogger } from '../logger.js';

const log = createLogger('exif');
let exiftool = null;

function getExifTool() {
	if (!exiftool) {
		exiftool = new ExifTool({ taskTimeoutMillis: 10000 });
	}
	return exiftool;
}

/**
 * Extract EXIF, XMP, and PNG text chunk metadata using exiftool-vendored.
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function extractExif(filePath) {
	try {
		const tags = await getExifTool().read(filePath);
		return tags;
	} catch (err) {
		log.error(`extraction failed for ${filePath}:`, err.message);
		return null;
	}
}

export async function shutdownExifTool() {
	if (exiftool) {
		await exiftool.end();
		exiftool = null;
	}
}
