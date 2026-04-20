/**
 * Parse Midjourney image metadata.
 * Midjourney embeds the prompt and job info in EXIF Description/UserComment.
 */
export function parseMidjourney(exifTags, chunks) {
	const result = {
		platform: 'midjourney',
		prompt: '',
		negativePrompt: '',
		modelName: 'Midjourney',
		modelVersion: '',
		seed: '',
		width: 0,
		height: 0,
		aspectRatio: '',
		stylize: '',
		otherParams: {}
	};

	// Midjourney puts the full prompt string (with params) in Description or UserComment
	const raw =
		exifTags?.Description ||
		exifTags?.ImageDescription ||
		exifTags?.UserComment ||
		exifTags?.['XMP:Description'] ||
		'';

	if (raw) {
		// Extract --version
		const vMatch = raw.match(/--v\s+([\d.]+)/);
		if (vMatch) result.modelVersion = `v${vMatch[1]}`;

		// Extract --seed
		const seedMatch = raw.match(/--seed\s+(\d+)/);
		if (seedMatch) result.seed = seedMatch[1];

		// Extract --ar
		const arMatch = raw.match(/--ar\s+([\d:]+)/);
		if (arMatch) result.aspectRatio = arMatch[1];

		// Extract --stylize
		const styleMatch = raw.match(/--stylize\s+(\d+)/i) || raw.match(/--s\s+(\d+)/);
		if (styleMatch) result.stylize = styleMatch[1];

		// Prompt is everything before the first --param
		const paramStart = raw.search(/\s+--/);
		result.prompt = paramStart > -1 ? raw.slice(0, paramStart).trim() : raw.trim();

		result.otherParams.fullPromptString = raw;
	}

	result.width = exifTags?.ImageWidth || exifTags?.ExifImageWidth || 0;
	result.height = exifTags?.ImageHeight || exifTags?.ExifImageHeight || 0;

	return result;
}

export function isMidjourney(exifTags, chunks) {
	const desc = exifTags?.Description || exifTags?.ImageDescription || exifTags?.UserComment || '';
	const software = exifTags?.Software || '';
	return (
		software.toLowerCase().includes('midjourney') ||
		/--v\s+\d/.test(desc) ||
		/--ar\s+[\d:]+/.test(desc)
	);
}
