/**
 * Parse Freepik / Pikaso AI image metadata.
 * Freepik embeds generation data in XMP and EXIF fields.
 */

export const id = 'freepik';

// Fields we typically see on Freepik / Pikaso exports. Low coverage may mean
// Freepik rebranded their Software tag or moved fields into new XMP locations.
export const coreFields = ['prompt', 'modelName', 'width', 'height'];

export function detect(exifTags, chunks) {
	const creator = (exifTags?.Creator || exifTags?.Artist || exifTags?.['XMP:Creator'] || '').toLowerCase();
	const software = (exifTags?.Software || exifTags?.['XMP:Software'] || '').toLowerCase();
	const copyright = (exifTags?.Copyright || exifTags?.['XMP:Rights'] || '').toLowerCase();

	return (
		creator.includes('freepik') ||
		creator.includes('pikaso') ||
		software.includes('freepik') ||
		software.includes('pikaso') ||
		copyright.includes('freepik')
	);
}

export function parse(exifTags, chunks) {
	const result = {
		platform: 'freepik',
		prompt: '',
		negativePrompt: '',
		modelName: '',
		modelVersion: '',
		seed: '',
		width: 0,
		height: 0,
		aspectRatio: '',
		otherParams: {}
	};

	// Prompt often lives in XMP Description, Subject, or custom fields
	result.prompt =
		exifTags?.['XMP:Description'] ||
		exifTags?.['XMP:Title'] ||
		exifTags?.['Description'] ||
		exifTags?.['ImageDescription'] ||
		'';

	// Model info
	result.modelName =
		exifTags?.['XMP:Creator'] ||
		exifTags?.['XMP:Software'] ||
		exifTags?.['Software'] ||
		'Freepik AI';

	// Dimensions
	result.width = exifTags?.ImageWidth || exifTags?.ExifImageWidth || 0;
	result.height = exifTags?.ImageHeight || exifTags?.ExifImageHeight || 0;
	if (result.width && result.height) {
		const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
		const d = gcd(result.width, result.height);
		result.aspectRatio = `${result.width / d}:${result.height / d}`;
	}

	// Check XMP for any Freepik-specific fields
	const xmpRaw = exifTags?.['XMP:All'] || exifTags?.['XMP'] || '';
	if (typeof xmpRaw === 'string' && xmpRaw.includes('freepik')) {
		result.otherParams.xmpSource = 'freepik';
	}

	// Some Freepik images store generation params as JSON in PNG chunks
	const parameters = chunks?.parameters || chunks?.Parameters || '';
	if (parameters) {
		result.otherParams.parameters = parameters;
		// Try to extract prompt if not found yet
		if (!result.prompt && parameters) {
			result.prompt = parameters.split('\n')[0] || '';
		}
	}

	return result;
}

