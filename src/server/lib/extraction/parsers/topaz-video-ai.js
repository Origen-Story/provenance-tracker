/**
 * Parse Topaz Video AI output.
 *
 * Topaz VAI writes a single `Videoai` tag into the container metadata of the
 * exported file, e.g.:
 *
 *   "Enhanced using prob-4; mode: auto; revert compression at 0; recover
 *    details at 0; sharpen at 0; reduce noise at 0; dehalo at 0; anti-alias/
 *    deblur at 0; focus fix Off; and recover original detail at 20. Changed
 *    resolution to 3840x2160"
 *
 * Topaz is a *modifier*, not a generator — it takes an existing video and
 * enhances it. We treat it as a platform for identification purposes but note
 * this in `otherParams.assetClass` so future schema work (provenance chaining
 * between an original and its enhanced output) has a flag to key off.
 *
 * Only Topaz Video AI is wired up here; Topaz Photo AI and Gigapixel (image
 * upscaling) are deferred — see docs/planned-features.md.
 */

export const id = 'topaz-video-ai';

export const coreFields = ['platform', 'modelName'];

export function detect(exifTags, chunks) {
	const tag = exifTags?.Videoai;
	return typeof tag === 'string' && tag.toLowerCase().includes('enhanced using');
}

export function parse(exifTags, chunks) {
	const tag = exifTags?.Videoai || '';

	const result = {
		platform: 'topaz-video-ai',
		prompt: '',
		negativePrompt: '',
		modelName: 'Topaz Video AI',
		modelVersion: '',
		seed: '',
		width: 0,
		height: 0,
		otherParams: {
			assetClass: 'modifier',
			videoaiRaw: tag
		}
	};

	const modelMatch = tag.match(/Enhanced using ([\w.-]+)/i);
	if (modelMatch) result.modelVersion = modelMatch[1];

	const modeMatch = tag.match(/mode:\s*(\w+)/i);
	if (modeMatch) result.otherParams.mode = modeMatch[1];

	const resMatch = tag.match(/Changed resolution to (\d+)x(\d+)/i);
	if (resMatch) {
		result.width = parseInt(resMatch[1], 10);
		result.height = parseInt(resMatch[2], 10);
	} else {
		result.width = exifTags?.ImageWidth || exifTags?.SourceImageWidth || 0;
		result.height = exifTags?.ImageHeight || exifTags?.SourceImageHeight || 0;
	}

	// The tag is a clean "<setting1> at <v1>; <setting2> at <v2>; ...; and <settingN> at <vN>. Changed ..."
	// list — split on ';' and regex each segment to avoid greedy cross-segment matches.
	const settings = {};
	for (const raw of tag.split(/[;.]/)) {
		let segment = raw.trim();
		if (!segment) continue;
		if (segment.toLowerCase().startsWith('and ')) segment = segment.slice(4);
		const m = segment.match(/^([a-z][a-z /-]*?)\s+at\s+(-?\d+(?:\.\d+)?)$/i);
		if (m) {
			const key = m[1].trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '_');
			settings[key] = Number(m[2]);
		}
	}
	if (Object.keys(settings).length) result.otherParams.settings = settings;

	return result;
}
