/**
 * Detect which AI platform generated the file based on metadata signatures.
 *
 * @param {{ exif: object|null, pngText: Record<string,string>|null, c2pa: object|null }} raw
 * @param {string} [filePath] - Optional file path for filename-based detection
 * @returns {string} Platform identifier
 */
export function detectPlatform(raw, filePath = '') {
	const { exif, pngText, c2pa } = raw;

	// ComfyUI: has both 'prompt' and 'workflow' PNG text chunks
	if (pngText && pngText.prompt && pngText.workflow) {
		return 'comfyui';
	}

	// MidJourney direct: has 'Description' + 'Author' PNG text chunks
	if (pngText && pngText.Description && pngText.Author) {
		return 'midjourney';
	}

	// Check C2PA claim generator
	if (c2pa) {
		const claimGen = findClaimGenerator(c2pa);
		if (claimGen) {
			if (claimGen.toLowerCase().includes('google')) return 'freepik';
			if (claimGen.toLowerCase().includes('midjourney')) return 'midjourney';
		}
	}

	// Freepik: XMP Credit "Made with Google AI" or filename starts with "freepik__"
	if (exif?.Credit && exif.Credit.toLowerCase().includes('google ai')) {
		return 'freepik';
	}
	if (filePath) {
		const basename = filePath.split('/').pop()?.split('\\').pop() || '';
		if (basename.toLowerCase().startsWith('freepik__')) {
			return 'freepik';
		}
	}

	// Meta.ai: has XMP DigitalSourceType but no other identifying markers
	if (exif) {
		const dst =
			exif.DigitalSourceType ||
			exif['DigitalSourceType'] ||
			exif['Iptc4xmpExt:DigitalSourceType'] ||
			exif['DigitalSourceFileType'];

		if (dst && typeof dst === 'string' && dst.includes('trainedAlgorithmicMedia')) {
			return 'meta-ai';
		}
	}

	return 'unknown';
}

function findClaimGenerator(c2pa) {
	// c2patool output structure varies — search for claim_generator or claim_generator_info
	if (typeof c2pa !== 'object') return null;

	// Try direct property
	if (c2pa.claim_generator) return c2pa.claim_generator;
	if (c2pa.claim_generator_info) {
		const info = Array.isArray(c2pa.claim_generator_info)
			? c2pa.claim_generator_info[0]
			: c2pa.claim_generator_info;
		return info?.name || null;
	}

	// Search in manifests
	if (c2pa.manifests) {
		for (const key of Object.keys(c2pa.manifests)) {
			const m = c2pa.manifests[key];
			if (m.claim_generator) return m.claim_generator;
			if (m.claim_generator_info) {
				const info = Array.isArray(m.claim_generator_info)
					? m.claim_generator_info[0]
					: m.claim_generator_info;
				return info?.name || null;
			}
		}
	}

	// Search in active_manifest
	if (c2pa.active_manifest) {
		const am =
			typeof c2pa.active_manifest === 'string'
				? c2pa.manifests?.[c2pa.active_manifest]
				: c2pa.active_manifest;
		if (am?.claim_generator) return am.claim_generator;
	}

	return null;
}
