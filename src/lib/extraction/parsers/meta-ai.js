import path from 'path';

/**
 * Parse Meta.ai metadata from XMP + filename.
 *
 * Meta.ai images have:
 *   - XMP DigitalSourceType: trainedAlgorithmicMedia
 *   - Filename contains truncated prompt (underscores for spaces)
 *
 * @param {{ exif: object|null, pngText: Record<string,string>|null, c2pa: object|null }} raw
 * @param {string} filePath
 * @returns {{ parsed: object, gaps: string[] }}
 */
export function parseMetaAiMetadata(raw, filePath) {
	const { exif } = raw;

	const digitalSourceType =
		exif?.DigitalSourceType ||
		exif?.['DigitalSourceFileType'] ||
		'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

	// Extract prompt fragment from filename
	const basename = path.basename(filePath, path.extname(filePath));
	const promptFragment = cleanFilenameToPrompt(basename);

	const parsed = {
		prompt: promptFragment,
		modelName: 'Meta AI (Imagine)',
		digitalSourceType,
		otherParams: {}
	};

	// Extract any other XMP fields
	if (exif?.Credit) parsed.otherParams.credit = exif.Credit;
	if (exif?.ImageWidth) parsed.width = exif.ImageWidth;
	if (exif?.ImageHeight) parsed.height = exif.ImageHeight;

	const gaps = ['description', 'fullPrompt', 'modelVersion', 'seed', 'generationDate', 'assetType'];

	return { parsed, gaps };
}

/**
 * Clean a filename into a readable prompt fragment.
 * "cinematic_medium_shot_of_a_tough_edgy (1)" → "cinematic medium shot of a tough edgy"
 */
function cleanFilenameToPrompt(basename) {
	return basename
		.replace(/\s*\(\d+\)\s*$/, '') // remove trailing (1), (2), etc.
		.replace(/_/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
