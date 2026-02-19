/**
 * Parse MidJourney metadata from PNG Description chunk.
 *
 * Prompt format: "base prompt text --ar 16:9 --v 6.1 --seed 98765 --stylize 250 --style raw"
 *
 * @param {{ exif: object|null, pngText: Record<string,string>|null, c2pa: object|null }} raw
 * @returns {{ parsed: object, gaps: string[] }}
 */
export function parseMidjourneyMetadata(raw) {
	const { pngText, exif } = raw;

	const description = pngText?.Description || exif?.Description || '';
	const author = pngText?.Author || exif?.Author || '';

	if (!description) {
		return {
			parsed: { modelName: 'Midjourney', author },
			gaps: [
				'prompt',
				'modelVersion',
				'seed',
				'aspectRatio',
				'stylize',
				'description',
				'assetType',
				'generationDate',
				'digitalSourceType'
			]
		};
	}

	const { basePrompt, params } = parsePromptString(description);

	const parsed = {
		prompt: basePrompt,
		negativePrompt: params.no || '',
		modelName: 'Midjourney',
		modelVersion: params.v || params.version || '',
		seed: params.seed || '',
		aspectRatio: params.ar || '',
		stylize: params.stylize || params.s || '',
		styleRaw: params.style || '',
		author,
		otherParams: {}
	};

	// Collect remaining params
	const knownParams = new Set(['v', 'version', 'seed', 'ar', 'stylize', 's', 'style', 'no']);
	for (const [key, value] of Object.entries(params)) {
		if (!knownParams.has(key)) {
			parsed.otherParams[key] = value;
		}
	}

	const gaps = [];
	if (!parsed.prompt) gaps.push('prompt');
	gaps.push('description', 'assetType', 'generationDate', 'digitalSourceType');

	return { parsed, gaps };
}

/**
 * Parse a MidJourney prompt string into base prompt + parameters.
 * @param {string} promptStr
 * @returns {{ basePrompt: string, params: Record<string, string> }}
 */
function parsePromptString(promptStr) {
	const params = {};

	// Find the first -- parameter
	const firstParamIdx = promptStr.indexOf(' --');
	if (firstParamIdx === -1) {
		return { basePrompt: promptStr.trim(), params };
	}

	const basePrompt = promptStr.substring(0, firstParamIdx).trim();
	const paramString = promptStr.substring(firstParamIdx);

	// Special handling for --no (captures everything until next --)
	const noMatch = paramString.match(/--no\s+(.+?)(?=\s+--|$)/);
	if (noMatch) {
		params.no = noMatch[1].trim();
	}

	// Extract all --param value pairs
	const paramRegex = /--(\w+)\s+([^\s]+)/g;
	let match;
	while ((match = paramRegex.exec(paramString)) !== null) {
		const key = match[1];
		const value = match[2];
		if (key !== 'no') {
			params[key] = value;
		}
	}

	return { basePrompt, params };
}
