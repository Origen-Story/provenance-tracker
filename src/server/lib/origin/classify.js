// Pure: propose an origin class for an asset from the signals extraction
// already collected. Decision D3 fixes the vocabulary; this module decides
// which signal wins and records why (`source`) so the UI and the auditor can
// show the rule, not just the answer. The user confirms or overrides.
//
// Signal order, strongest first:
//   1. A C2PA manifest whose created action says capture (Pixel, Leica, ...).
//   2. A C2PA manifest with ingredients or placed actions: an edited output.
//   3. A modifier tool (Topaz upscale/enhance): class follows the parent.
//   4. A C2PA created/edited action with a generated source type.
//   5. XMP/IPTC digital source type or an AI credit line, written by tools
//      that do not sign (Topaz Gigapixel, many web generators).
//   6. Which table the asset lives in.

export const ORIGIN_CLASSES = [
	'captured_signed',
	'captured',
	'archival',
	'archival_enhanced',
	'generated',
	'composited',
	'unknown'
];

const CAPTURE_SOURCE_TYPES = ['digitalCapture', 'computationalCapture'];
const GENERATED_SOURCE_TYPES = ['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'algorithmicMedia'];
const CAPTURE_DEVICE_PATTERNS = [/pixel camera/i, /\bleica\b/i, /\bsony\b/i, /\bnikon\b/i, /\bcanon\b/i, /\bsamsung\b/i, /truepic/i, /\bapple\b|iphone/i, /\bqualcomm\b/i];

function lastSegment(uri) {
	return String(uri || '').split('/').pop();
}

// Flatten the parts of a stored C2PA summary that classification cares about.
export function c2paSignals(summary) {
	if (!summary || typeof summary !== 'object' || summary._readError) {
		return { hasManifest: false, readError: !!summary?._readError, actions: [], sourceTypes: [], ingredients: 0, issuer: '', commonName: '', claimGenerator: '' };
	}
	const actions = [];
	for (const a of summary.assertions || []) {
		if (!String(a.label || '').startsWith('c2pa.actions')) continue;
		for (const act of a.data?.actions || []) actions.push(act);
	}
	const sourceTypes = actions.map(a => lastSegment(a.digitalSourceType)).filter(Boolean);
	return {
		hasManifest: true,
		readError: false,
		actions,
		sourceTypes,
		ingredients: (summary.ingredients || []).length,
		issuer: summary.signatureInfo?.issuer || '',
		commonName: summary.signatureInfo?.commonName || '',
		claimGenerator: summary.claimGenerator || ''
	};
}

function isCaptureDevice(sig) {
	const hay = `${sig.issuer} ${sig.commonName} ${sig.claimGenerator}`;
	return CAPTURE_DEVICE_PATTERNS.some(re => re.test(hay));
}

function isModifier(platform, platformData) {
	if (platformData?.assetClass === 'modifier' || platformData?.otherParams?.assetClass === 'modifier') return true;
	return /topaz/i.test(String(platform || ''));
}

/**
 * @param {object} input
 * @param {'ai'|'archival'|'produced'} input.table
 * @param {object|null} input.c2paSummary  stored c2paJson, parsed
 * @param {string} [input.platform]        parser id for AI assets
 * @param {object} [input.platformData]    parsed platform blob (parser output)
 * @param {object} [input.exifTags]        stored exifJson, parsed
 * @param {string|null} [input.parentClass] origin class of a derived_from parent
 * @returns {{ originClass: string, source: string, captureSigned: boolean }}
 */
export function proposeOriginClass({ table, c2paSummary = null, platform = '', platformData = null, exifTags = null, parentClass = null }) {
	const sig = c2paSignals(c2paSummary);
	const exif = exifTags || {};

	// 1. Signed capture.
	if (sig.hasManifest) {
		const captureAction = sig.actions.some(a => a.action === 'c2pa.created' && CAPTURE_SOURCE_TYPES.includes(lastSegment(a.digitalSourceType)));
		if (captureAction) return { originClass: 'captured_signed', source: 'c2pa_capture_action', captureSigned: true };
		const generatedAction = sig.sourceTypes.some(s => GENERATED_SOURCE_TYPES.includes(s));
		if (!generatedAction && isCaptureDevice(sig)) return { originClass: 'captured_signed', source: 'c2pa_capture_device', captureSigned: true };
	}

	// 2. An output with ingredients (an NLE export, a composite).
	if (sig.hasManifest && (sig.ingredients > 0 || sig.actions.some(a => a.action === 'c2pa.placed'))) {
		return { originClass: 'composited', source: 'c2pa_ingredients', captureSigned: false };
	}

	// 3. Modifier tools inherit from their parent.
	if (isModifier(platform, platformData)) {
		if (parentClass === 'archival' || parentClass === 'archival_enhanced') return { originClass: 'archival_enhanced', source: 'modifier_of_archival', captureSigned: false };
		if (parentClass === 'generated') return { originClass: 'generated', source: 'modifier_of_generated', captureSigned: false };
		if (parentClass) return { originClass: 'unknown', source: `modifier_of_${parentClass}`, captureSigned: false };
		return { originClass: 'unknown', source: 'modifier_unlinked', captureSigned: false };
	}

	// 4. Signed generation.
	if (sig.hasManifest && sig.sourceTypes.some(s => GENERATED_SOURCE_TYPES.includes(s))) {
		return { originClass: 'generated', source: 'c2pa_generated_action', captureSigned: false };
	}

	// 5. Unsigned XMP/IPTC hints.
	const dst = lastSegment(exif.DigitalSourceType);
	if (GENERATED_SOURCE_TYPES.includes(dst)) return { originClass: 'generated', source: 'xmp_digital_source_type', captureSigned: false };
	if (CAPTURE_SOURCE_TYPES.includes(dst)) return { originClass: 'captured', source: 'xmp_digital_source_type', captureSigned: false };
	if (/made with .*\bai\b/i.test(String(exif.Credit || ''))) return { originClass: 'generated', source: 'xmp_credit', captureSigned: false };

	// 6. Table defaults.
	if (table === 'archival') return { originClass: 'archival', source: 'table_archival', captureSigned: false };
	if (table === 'produced') return { originClass: 'captured', source: 'table_produced', captureSigned: false };
	if (table === 'ai') {
		if (platform && platform !== 'unknown') return { originClass: 'generated', source: 'platform_parser', captureSigned: false };
		return { originClass: 'unknown', source: 'no_signal', captureSigned: false };
	}
	return { originClass: 'unknown', source: 'no_signal', captureSigned: false };
}

// Parse the stored JSON blobs defensively; rows imported before this module
// existed may hold '{}' or malformed text.
export function parseJsonSafe(text, fallback = null) {
	if (!text || typeof text !== 'string') return fallback;
	try { return JSON.parse(text); } catch { return fallback; }
}
