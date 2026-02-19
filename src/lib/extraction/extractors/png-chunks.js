import { readFileSync } from 'fs';
import extract from 'png-chunks-extract';
import text from 'png-chunk-text';

/**
 * Extract PNG tEXt chunks from a PNG file.
 * Returns a map of chunk keyword → text value.
 *
 * ComfyUI images contain:
 *   { prompt: '{...json...}', workflow: '{...json...}' }
 *
 * MidJourney images contain:
 *   { Description: 'prompt text', Author: 'username' }
 *
 * @param {string} filePath - Must be a PNG file
 * @returns {Record<string, string>|null}
 */
export function extractPngChunks(filePath) {
	try {
		const buf = readFileSync(filePath);

		// Verify PNG magic bytes
		if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
			return null;
		}

		const chunks = extract(buf);
		const result = {};

		for (const chunk of chunks) {
			if (chunk.name === 'tEXt') {
				try {
					const decoded = text.decode(chunk.data);
					result[decoded.keyword] = decoded.text;
				} catch {
					// skip malformed chunks
				}
			}
		}

		return Object.keys(result).length > 0 ? result : null;
	} catch (err) {
		console.error(`PNG chunk extraction failed for ${filePath}:`, err.message);
		return null;
	}
}
