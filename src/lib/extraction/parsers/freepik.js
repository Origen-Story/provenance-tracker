import path from 'path';

/**
 * Parse Freepik metadata from C2PA manifest + XMP.
 *
 * Freepik AI images have:
 *   - C2PA manifest signed by "Google C2PA Core Generator Library"
 *   - XMP DigitalSourceType: trainedAlgorithmicMedia
 *   - XMP Credit: "Made with Google AI"
 *   - Filename format: freepik__prompt-text__12345.png
 *
 * @param {{ exif: object|null, pngText: Record<string,string>|null, c2pa: object|null }} raw
 * @param {string} filePath
 * @returns {{ parsed: object, gaps: string[] }}
 */
export function parseFreepikMetadata(raw, filePath) {
	const { exif, c2pa } = raw;

	const digitalSourceType =
		exif?.DigitalSourceType ||
		exif?.['DigitalSourceFileType'] ||
		'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

	const credit = exif?.Credit || '';

	const parsed = {
		modelName: 'Freepik AI',
		digitalSourceType,
		otherParams: {
			credit,
			hasC2pa: !!c2pa
		}
	};

	// Try to extract prompt from filename
	const basename = path.basename(filePath, path.extname(filePath));
	const promptFromFilename = parseFreepikFilename(basename);
	if (promptFromFilename) {
		parsed.prompt = promptFromFilename;
	}

	// Extract dimensions from EXIF
	if (exif?.ImageWidth) parsed.width = exif.ImageWidth;
	if (exif?.ImageHeight) parsed.height = exif.ImageHeight;

	// Extract timestamp from C2PA if available
	if (c2pa) {
		const timestamp = findC2paTimestamp(c2pa);
		if (timestamp) parsed.generationDate = timestamp;
	}

	const gaps = ['description', 'prompt', 'seed', 'assetType'];
	if (!parsed.prompt) gaps.unshift('prompt');
	if (!parsed.generationDate) gaps.push('generationDate');

	return { parsed, gaps };
}

/**
 * Parse Freepik filename format: "freepik__prompt-text-here__12345"
 */
function parseFreepikFilename(basename) {
	const parts = basename.split('__');
	if (parts.length >= 2 && parts[0].toLowerCase() === 'freepik') {
		return parts[1].replace(/-/g, ' ').trim();
	}
	return '';
}

function findC2paTimestamp(c2pa) {
	if (!c2pa || typeof c2pa !== 'object') return null;

	// Check manifests for signature timestamps
	if (c2pa.manifests) {
		for (const key of Object.keys(c2pa.manifests)) {
			const m = c2pa.manifests[key];
			if (m.signature_info?.time) return m.signature_info.time;
		}
	}

	if (c2pa.signature_info?.time) return c2pa.signature_info.time;

	return null;
}
