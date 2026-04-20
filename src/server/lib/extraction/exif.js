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
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function extractExif(filePath) {
	try {
		const tags = await getExifTool().read(filePath);
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
