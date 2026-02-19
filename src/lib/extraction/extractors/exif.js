import { ExifTool } from 'exiftool-vendored';

let exiftool = null;

function getExifTool() {
	if (!exiftool) {
		exiftool = new ExifTool({ taskTimeoutMillis: 10000 });
	}
	return exiftool;
}

/**
 * Extract EXIF, XMP, and PNG text chunk metadata using exiftool-vendored.
 * Returns the raw tags object.
 *
 * Key fields by platform:
 *   MidJourney: tags.Description (prompt), tags.Author (username)
 *   Meta.ai:    tags.DigitalSourceType (XMP)
 *   Freepik:    tags.DigitalSourceType, tags.Credit (XMP)
 *   General:    tags.ImageWidth, tags.ImageHeight, tags.FileType
 *
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function extractExif(filePath) {
	try {
		const et = getExifTool();
		const tags = await et.read(filePath);
		return tags;
	} catch (err) {
		console.error(`EXIF extraction failed for ${filePath}:`, err.message);
		return null;
	}
}

export async function shutdownExifTool() {
	if (exiftool) {
		await exiftool.end();
		exiftool = null;
	}
}
