// Pure: propose an origin class for an asset from the signals extraction
// already collected. The vocabulary is the IPTC Digital Source Type list
// (decision D11, src/shared/origin-vocabulary.js), so a term a file declares
// is kept as it is. This module decides which signal wins and records why
// (`source`), so the UI and the auditor can show the rule, not just the
// answer. It also reports who signed the file, which is an attribute beside
// the class. The user confirms or overrides.
//
// Tools apply the terms loosely, so a declared term is read in context:
//   - Premiere stamps an export `compositeWithTrainedAlgorithmicMedia` (one
//     asset edited with generative AI) while listing placed ingredients; an
//     asset with component ingredients is a composite.
//   - Firefly declares an `empty` canvas and then an edit with generative AI;
//     nothing but the model made it, so it is AI-generated.
//
// Signal order, strongest first:
//   1. A C2PA manifest: component ingredients, then the declared source type.
//   2. A modifier tool (an upscaler): AI-enhanced, or its parent's class when
//      the parent is itself generated.
//   3. XMP/IPTC digital source type or an AI credit line, from tools that do
//      not sign.
//   4. Which table the asset lives in.

import { ORIGIN_CLASSES, normalizeSourceType, originClassDef } from '../../../shared/origin-vocabulary.js';

export { ORIGIN_CLASSES };

const CAPTURE_CODES = ['digitalCapture', 'computationalCapture'];
const COMPOSITE_CODES = ['compositeCapture', 'compositeSynthetic', 'composite'];
const GENERATIVE_CODES = ['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'compositeSynthetic'];
const CAPTURE_DEVICE_PATTERNS = [/pixel camera/i, /c2pa sdk for android/i, /\bleica\b/i, /\bsony\b/i, /\bnikon\b/i, /\bcanon\b/i, /\bsamsung\b/i, /truepic/i, /\bapple\b|iphone/i, /\bqualcomm\b/i];
// Claim generators that mean the creator signed the file themselves.
const CREATOR_SIGNER_PATTERNS = [/provenance[-_ ]?tracker/i, /\bc2patool\b/i];

// Flatten the parts of a stored C2PA summary that classification cares about.
export function c2paSignals(summary) {
	if (!summary || typeof summary !== 'object' || summary._readError) {
		return { hasManifest: false, readError: !!summary?._readError, actions: [], sourceTypes: [], createdType: null, ingredients: 0, components: 0, placed: false, issuer: '', commonName: '', claimGenerator: '' };
	}
	const actions = [];
	for (const a of summary.assertions || []) {
		if (!String(a.label || '').startsWith('c2pa.actions')) continue;
		for (const act of a.data?.actions || []) actions.push(act);
	}
	const sourceTypes = actions.map(a => normalizeSourceType(a.digitalSourceType)).filter(Boolean);
	const created = actions.find(a => a.action === 'c2pa.created');
	const ingredients = summary.ingredients || [];
	return {
		hasManifest: true,
		readError: false,
		actions,
		sourceTypes,
		createdType: created ? normalizeSourceType(created.digitalSourceType) : null,
		ingredients: ingredients.length,
		// A parentOf ingredient is the file's own earlier version, not a part.
		components: ingredients.filter(i => (i.relationship || 'componentOf') === 'componentOf').length,
		placed: actions.some(a => a.action === 'c2pa.placed'),
		issuer: summary.signatureInfo?.issuer || '',
		commonName: summary.signatureInfo?.commonName || '',
		claimGenerator: summary.claimGenerator || ''
	};
}

function isCaptureDevice(sig) {
	const hay = `${sig.issuer} ${sig.commonName} ${sig.claimGenerator}`;
	return CAPTURE_DEVICE_PATTERNS.some(re => re.test(hay));
}

/**
 * Who vouches for the file: the creator (signed at ingest with this tool or
 * c2patool, or a certificate named in `ownSignerNames`), the capture device,
 * or the tool that made or exported it. '' when there is no manifest.
 */
export function signerOf(sig, ownSignerNames = []) {
	if (!sig.hasManifest) return { signedBy: '', signerName: '' };
	const signerName = sig.commonName || sig.issuer || sig.claimGenerator || '';
	const own = ownSignerNames.map(n => String(n || '').toLowerCase()).filter(Boolean);
	const mine = own.some(n => sig.commonName.toLowerCase() === n || sig.issuer.toLowerCase() === n);
	if (mine || CREATOR_SIGNER_PATTERNS.some(re => re.test(sig.claimGenerator))) return { signedBy: 'creator', signerName };
	if (isCaptureDevice(sig)) return { signedBy: 'device', signerName };
	return { signedBy: 'tool', signerName };
}

function isModifier(platform, platformData) {
	if (platformData?.assetClass === 'modifier' || platformData?.otherParams?.assetClass === 'modifier') return true;
	return /topaz/i.test(String(platform || ''));
}

function fromManifest(sig) {
	// Parts placed into it: a composite, whatever single-asset term the tool wrote.
	if (sig.components > 0 || sig.placed) {
		if (COMPOSITE_CODES.includes(sig.createdType)) return { originClass: sig.createdType, source: 'c2pa_ingredients' };
		if (sig.sourceTypes.some(s => GENERATIVE_CODES.includes(s))) return { originClass: 'compositeSynthetic', source: 'c2pa_ingredients' };
		return { originClass: 'composite', source: 'c2pa_ingredients' };
	}
	// A blank canvas that only a generative model filled.
	if (sig.createdType === 'empty') {
		if (sig.sourceTypes.some(s => s === 'trainedAlgorithmicMedia' || s === 'compositeWithTrainedAlgorithmicMedia')) return { originClass: 'trainedAlgorithmicMedia', source: 'c2pa_generated_from_empty' };
		const later = sig.sourceTypes.find(s => s !== 'empty');
		if (later) return { originClass: later, source: 'c2pa_declared' };
		return null;
	}
	// What the file says it is.
	if (sig.createdType) {
		return { originClass: sig.createdType, source: CAPTURE_CODES.includes(sig.createdType) ? 'c2pa_capture_action' : sig.createdType === 'trainedAlgorithmicMedia' ? 'c2pa_generated_action' : 'c2pa_declared' };
	}
	// No created action with a source type.
	const declared = sig.sourceTypes.filter(s => s !== 'empty');
	if (declared.includes('trainedAlgorithmicMedia')) return { originClass: 'trainedAlgorithmicMedia', source: 'c2pa_generated_action' };
	if (declared.length) return { originClass: declared[0], source: 'c2pa_declared' };
	if (isCaptureDevice(sig)) return { originClass: 'digitalCapture', source: 'c2pa_capture_device' };
	return null;
}

/**
 * @param {object} input
 * @param {'ai'|'archival'|'produced'} input.table
 * @param {object|null} input.c2paSummary  stored c2paJson, parsed
 * @param {string} [input.platform]        parser id for AI assets
 * @param {object} [input.platformData]    parsed platform blob (parser output)
 * @param {object} [input.exifTags]        stored exifJson, parsed
 * @param {string|null} [input.parentClass] origin class of a derived_from parent
 * @param {string[]} [input.ownSignerNames] certificate names that mean "the creator signed this"
 * @returns {{ originClass: string, source: string, signedBy: string, signerName: string, captureSigned: boolean }}
 */
export function proposeOriginClass({ table, c2paSummary = null, platform = '', platformData = null, exifTags = null, parentClass = null, ownSignerNames = [] }) {
	const sig = c2paSignals(c2paSummary);
	const exif = exifTags || {};
	const signer = signerOf(sig, ownSignerNames);
	const done = (originClass, source) => ({ originClass, source, ...signer, captureSigned: signer.signedBy === 'device' });

	// 1. What the signed manifest says.
	if (sig.hasManifest) {
		const m = fromManifest(sig);
		if (m) return done(m.originClass, m.source);
	}

	// 2. An enhancer's output. Enhancing generated material leaves it generated;
	// enhancing anything else makes it AI-enhanced. Without a known source it
	// stays unknown, which asks the user to link one.
	if (isModifier(platform, platformData)) {
		if (!parentClass) return done('unknown', 'modifier_unlinked');
		if (parentClass === 'unknown') return done('unknown', 'modifier_of_unknown');
		const parentPosition = originClassDef(parentClass).position;
		if (parentPosition === 'synthetic' || parentPosition === 'hybrid') return done(parentClass, 'modifier_of_generated');
		return done('algorithmicallyEnhanced', 'modifier_enhanced');
	}

	// 3. Unsigned XMP/IPTC hints.
	const dst = normalizeSourceType(exif.DigitalSourceType);
	if (dst && dst !== 'empty') return done(dst, 'xmp_digital_source_type');
	if (/made with .*\bai\b/i.test(String(exif.Credit || ''))) return done('trainedAlgorithmicMedia', 'xmp_credit');

	// 4. Table defaults. An archive image is assumed to be a scan; a produced
	// recording is assumed to be a capture. Both are proposals to review.
	if (table === 'archival') return done('print', 'table_archival');
	if (table === 'produced') return done('digitalCapture', 'table_produced');
	if (table === 'ai' && platform && platform !== 'unknown') return done('trainedAlgorithmicMedia', 'platform_parser');
	return done('unknown', 'no_signal');
}

// Parse the stored JSON blobs defensively; rows imported before this module
// existed may hold '{}' or malformed text.
export function parseJsonSafe(text, fallback = null) {
	if (!text || typeof text !== 'string') return fallback;
	try { return JSON.parse(text); } catch { return fallback; }
}
