/**
 * Parse Adobe Firefly metadata (image + video).
 *
 * Firefly embeds a C2PA manifest that exiftool flattens onto the top-level tag
 * object. Key signals:
 *   - `Claim_generator === 'Adobe_Firefly'`
 *   - `Actions.softwareAgent === 'Adobe Firefly'` (image — single object)
 *   - `Actions[*].softwareAgent === 'Adobe Firefly'` (video — array, look at c2pa.edited)
 *
 * Firefly does NOT embed the prompt in the file; the prompt lives in the
 * filename (e.g. "Firefly_a lighthouse at dusk 983684.png"). We leave
 * prompt extraction to the UI / user for now.
 */

export const id = 'firefly';

// Firefly always exposes softwareAgent + claim generator + operation. Version is
// a long string but reliably present. If these drop out, Adobe has changed the
// C2PA claim format.
export const coreFields = ['platform', 'modelName', 'modelVersion'];

function fireflyAction(actions) {
	if (!actions) return null;
	if (Array.isArray(actions)) {
		return actions.find(a => a?.softwareAgent === 'Adobe Firefly') || null;
	}
	if (actions?.softwareAgent === 'Adobe Firefly') return actions;
	return null;
}

export function detect(exifTags, chunks) {
	if (!exifTags) return false;
	if (exifTags.Claim_generator === 'Adobe_Firefly') return true;
	if (exifTags.Claim_generator_info?.name === 'Adobe_Firefly') return true;
	return !!fireflyAction(exifTags.Actions);
}

export function parse(exifTags, chunks) {
	const result = {
		platform: 'firefly',
		prompt: '',
		negativePrompt: '',
		modelName: 'Adobe Firefly',
		modelVersion: '',
		seed: '',
		width: 0,
		height: 0,
		aspectRatio: '',
		otherParams: {}
	};

	const action = fireflyAction(exifTags?.Actions);
	const params = action?.parameters || {};

	// Firefly model version string, e.g. "image5-release_restricted-firefly_v5-main_107429.129362"
	const version = params['com.adobe.firefly.version'];
	if (version) result.modelVersion = version;

	// Operation type: "text_to_image", "generative_fill", etc.
	const operation = params['com.adobe.firefly.operation'];
	if (operation) result.otherParams.operation = operation;

	// c2pa.created vs c2pa.edited distinguishes fresh-gen image from video edit
	if (action?.action) result.otherParams.c2paAction = action.action;
	if (action?.digitalSourceType) result.otherParams.digitalSourceType = action.digitalSourceType;

	// Dimensions — image uses ImageWidth/Height; video falls back to SourceImage*.
	result.width = exifTags?.ImageWidth || exifTags?.SourceImageWidth || 0;
	result.height = exifTags?.ImageHeight || exifTags?.SourceImageHeight || 0;
	if (result.width && result.height) {
		const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
		const d = gcd(result.width, result.height);
		result.aspectRatio = `${result.width / d}:${result.height / d}`;
	}

	return result;
}
