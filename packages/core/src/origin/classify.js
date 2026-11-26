// Pure: propose an origin class for an asset from the signals extraction
// already collected. The vocabulary is the IPTC Digital Source Type list
// (decision D11, src/shared/origin-vocabulary.js), so a term a file declares
// is kept as it is. This module decides which signal wins and records why
// (`source`), so the UI and the auditor can show the rule, not just the
// answer. It also reports who signed the file, which is an attribute beside
// the class. The user confirms or overrides.
//
// Who signed is only said of a claim that verified (D67). Anyone can write a
// manifest that names Sony as its signer or this tracker as its generator, so
// a name counts for nothing on its own: a file is "device-signed" only when
// the reader found the signer on the C2PA trust list, and "signed by the
// creator" only when this catalog's own signing record covers it. Where a
// claim did not verify, the name its credentials give is kept as exactly
// that, "unverified": worth knowing in the tracker, and never said in a
// signed statement.
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

import {
	ORIGIN_CLASSES,
	UNVERIFIED_SIGNER,
	normalizeSourceType,
	originClassDef,
} from "../origin-vocabulary.js";

export { ORIGIN_CLASSES };

const CAPTURE_CODES = ["digitalCapture", "computationalCapture"];
const COMPOSITE_CODES = ["compositeCapture", "compositeSynthetic", "composite"];
const GENERATIVE_CODES = [
	"trainedAlgorithmicMedia",
	"compositeWithTrainedAlgorithmicMedia",
	"compositeSynthetic",
];
// Makers of capture devices, as their certificates name them. Read only from
// a certificate the reader found on the trust list, where the name is the
// list's word and not the file's; and only when the file declares no source
// type at all, since the same makers also sign what their software generates.
const CAPTURE_DEVICE_PATTERNS = [
	/pixel camera/i,
	/\bleica\b/i,
	/\bsony\b/i,
	/\bnikon\b/i,
	/\bcanon\b/i,
	/\bsamsung\b/i,
	/truepic/i,
	/\bapple\b|iphone/i,
	/\bqualcomm\b/i,
];
// An action's source type: the spec field, else a vendor-namespaced
// parameter. Firefly signs files from partner models (Seedance and others)
// with only `c2pa.opened` and `parameters["com.adobe.digitalSourceType"]`.
function actionSourceType(act) {
	if (act.digitalSourceType) return act.digitalSourceType;
	const params = act.parameters || {};
	const key = Object.keys(params).find(
		(k) => k === "digitalSourceType" || k.endsWith(".digitalSourceType"),
	);
	return key ? params[key] : undefined;
}

// Flatten the parts of a stored C2PA summary that classification cares about.
export function c2paSignals(summary) {
	if (!summary || typeof summary !== "object" || summary._readError) {
		return {
			hasManifest: false,
			readError: !!summary?._readError,
			actions: [],
			sourceTypes: [],
			createdType: null,
			ingredients: 0,
			components: 0,
			placed: false,
			issuer: "",
			commonName: "",
			claimGenerator: "",
			verdict: null,
			sound: false,
			trusted: false,
		};
	}
	// What the reading's codes come to; null for a summary that does not say
	// (one made by hand, or before readings carried a verdict).
	const verdict = summary.validation?.verdict ?? null;
	const actions = [];
	for (const a of summary.assertions || []) {
		if (!String(a.label || "").startsWith("c2pa.actions")) continue;
		for (const act of a.data?.actions || []) actions.push(act);
	}
	const sourceTypes = actions
		.map((a) => normalizeSourceType(actionSourceType(a)))
		.filter(Boolean);
	const created = actions.find((a) => a.action === "c2pa.created");
	const ingredients = summary.ingredients || [];
	return {
		hasManifest: true,
		readError: false,
		actions,
		sourceTypes,
		createdType: created
			? normalizeSourceType(actionSourceType(created))
			: null,
		ingredients: ingredients.length,
		// A parentOf ingredient is the file's own earlier version, not a part.
		components: ingredients.filter(
			(i) => (i.relationship || "componentOf") === "componentOf",
		).length,
		placed: actions.some((a) => a.action === "c2pa.placed"),
		issuer: summary.signatureInfo?.issuer || "",
		commonName: summary.signatureInfo?.commonName || "",
		claimGenerator: summary.claimGenerator || "",
		verdict,
		// The claim's signature verified and the file is the one it signed.
		sound: verdict !== "invalid" && verdict !== "hash_mismatch",
		// And the reader found its signer on the trust list.
		trusted: verdict === "valid",
	};
}

/**
 * A capture device signed it: a signer on the trust list that declares the
 * file a capture, or, when the file declares no source type, one whose
 * certificate names a device maker. The claim generator is never read for
 * this: it is text anyone can write.
 */
function isCaptureDevice(sig) {
	if (!sig.trusted) return false;
	if (CAPTURE_CODES.includes(sig.createdType)) return true;
	return (
		sig.sourceTypes.length === 0 &&
		CAPTURE_DEVICE_PATTERNS.some((re) =>
			re.test(`${sig.issuer} ${sig.commonName}`),
		)
	);
}

/**
 * Who vouches for the file: the creator, a capture device, or the tool that
 * made or exported it. '' when there is no manifest. When the claim did not
 * verify, or the file is not the one it signed, nobody vouches for it: the
 * name the credentials give is returned as "unverified", which is what the
 * file says and not a signer.
 *
 * "creator" is the caller's to say (`signedHere`): the catalog recorded
 * signing these bytes itself, with a certificate it knows by fingerprint. It
 * is never read from a name in the file, which anyone can write, nor from a
 * certificate's name, which anyone can give a certificate of their own.
 *
 * @param {object} sig c2paSignals(...)
 * @param {{ signedHere?: boolean }} [known]
 */
export function signerOf(sig, { signedHere = false } = {}) {
	if (!sig.hasManifest) return { signedBy: "", signerName: "" };
	const signerName = sig.commonName || sig.issuer || "";
	if (!sig.sound) return { signedBy: UNVERIFIED_SIGNER, signerName };
	if (signedHere) return { signedBy: "creator", signerName };
	if (isCaptureDevice(sig)) return { signedBy: "device", signerName };
	return { signedBy: "tool", signerName };
}

function isModifier(platform, platformData) {
	if (
		platformData?.assetClass === "modifier" ||
		platformData?.otherParams?.assetClass === "modifier"
	)
		return true;
	return /topaz/i.test(String(platform || ""));
}

function fromManifest(sig) {
	// Parts placed into it: a composite, whatever single-asset term the tool wrote.
	if (sig.components > 0 || sig.placed) {
		if (COMPOSITE_CODES.includes(sig.createdType))
			return { originClass: sig.createdType, source: "c2pa_ingredients" };
		// A re-signed edit (the tracker's own outputs) declares its composite
		// class on the action that opens the parent, not on a created action.
		const declaredComposite = sig.sourceTypes.find((s) =>
			COMPOSITE_CODES.includes(s),
		);
		if (declaredComposite)
			return { originClass: declaredComposite, source: "c2pa_ingredients" };
		if (sig.sourceTypes.some((s) => GENERATIVE_CODES.includes(s)))
			return { originClass: "compositeSynthetic", source: "c2pa_ingredients" };
		return { originClass: "composite", source: "c2pa_ingredients" };
	}
	// A blank canvas that only a generative model filled.
	if (sig.createdType === "empty") {
		if (
			sig.sourceTypes.some(
				(s) =>
					s === "trainedAlgorithmicMedia" ||
					s === "compositeWithTrainedAlgorithmicMedia",
			)
		)
			return {
				originClass: "trainedAlgorithmicMedia",
				source: "c2pa_generated_from_empty",
			};
		const later = sig.sourceTypes.find((s) => s !== "empty");
		if (later) return { originClass: later, source: "c2pa_declared" };
		return null;
	}
	// What the file says it is.
	if (sig.createdType) {
		return {
			originClass: sig.createdType,
			source: CAPTURE_CODES.includes(sig.createdType)
				? "c2pa_capture_action"
				: sig.createdType === "trainedAlgorithmicMedia"
					? "c2pa_generated_action"
					: "c2pa_declared",
		};
	}
	// No created action with a source type.
	const declared = sig.sourceTypes.filter((s) => s !== "empty");
	if (declared.includes("trainedAlgorithmicMedia"))
		return {
			originClass: "trainedAlgorithmicMedia",
			source: "c2pa_generated_action",
		};
	if (declared.length)
		return { originClass: declared[0], source: "c2pa_declared" };
	if (isCaptureDevice(sig))
		return { originClass: "digitalCapture", source: "c2pa_capture_device" };
	return null;
}

/**
 * @param {object} input
 * @param {'ai'|'archival'|'produced'} [input.table] which kind of asset it is (the old app's table); absent for one not sorted yet, which then gets no default class
 * @param {object|null} input.c2paSummary  stored c2paJson, parsed
 * @param {string} [input.platform]        parser id for AI assets
 * @param {object|null} [input.platformData] parsed platform blob (parser output)
 * @param {object|null} [input.exifTags] stored exifJson, parsed
 * @param {string|null} [input.parentClass] origin class of a derived_from parent
 * @param {boolean} [input.signedHere] the catalog's own signing record covers the credentials read (signerOf)
 * @returns {{ originClass: string, source: string, signedBy: string, signerName: string, captureSigned: boolean }}
 */
export function proposeOriginClass({
	table,
	c2paSummary = null,
	platform = "",
	platformData = null,
	exifTags = null,
	parentClass = null,
	signedHere = false,
}) {
	const sig = c2paSignals(c2paSummary);
	const exif = exifTags || {};
	const signer = signerOf(sig, { signedHere });
	const done = (originClass, source) => ({
		originClass,
		source,
		...signer,
		captureSigned: signer.signedBy === "device",
	});

	// 1. What the signed manifest says.
	if (sig.hasManifest) {
		const m = fromManifest(sig);
		if (m) return done(m.originClass, m.source);
	}

	// 2. An enhancer's output. Enhancing generated material leaves it generated;
	// enhancing anything else makes it AI-enhanced. Without a known source it
	// stays unknown, which asks the user to link one.
	if (isModifier(platform, platformData)) {
		if (!parentClass) return done("unknown", "modifier_unlinked");
		if (parentClass === "unknown")
			return done("unknown", "modifier_of_unknown");
		const parentPosition = originClassDef(parentClass).position;
		if (parentPosition === "synthetic" || parentPosition === "hybrid")
			return done(parentClass, "modifier_of_generated");
		return done("algorithmicallyEnhanced", "modifier_enhanced");
	}

	// 3. Unsigned XMP/IPTC hints.
	const dst = normalizeSourceType(exif.DigitalSourceType);
	if (dst && dst !== "empty") return done(dst, "xmp_digital_source_type");
	if (/made with .*\bai\b/i.test(String(exif.Credit || "")))
		return done("trainedAlgorithmicMedia", "xmp_credit");

	// 4. Table defaults. An archive image is assumed to be a scan; a produced
	// recording is assumed to be a capture. Both are proposals to review.
	if (table === "archival") return done("print", "table_archival");
	if (table === "produced") return done("digitalCapture", "table_produced");
	if (table === "ai" && platform && platform !== "unknown")
		return done("trainedAlgorithmicMedia", "platform_parser");
	return done("unknown", "no_signal");
}

/**
 * What a file's own credentials say it is, separate from the class the
 * tracker holds (which the user may have set by hand). `credentials` is
 * 'none' (no manifest), 'unreadable' (a manifest no reader could parse) or
 * 'present'; `originClass` is the declared class, or null when the manifest
 * names none.
 */
export function classClaimedByFile(c2paSummary) {
	if (c2paSummary?._readError)
		return { credentials: "unreadable", originClass: null };
	const sig = c2paSignals(c2paSummary);
	if (!sig.hasManifest) return { credentials: "none", originClass: null };
	const m = fromManifest(sig);
	return { credentials: "present", originClass: m ? m.originClass : null };
}

// Parse the stored JSON blobs defensively; rows imported before this module
// existed may hold '{}' or malformed text.
export function parseJsonSafe(text, fallback = null) {
	if (!text || typeof text !== "string") return fallback;
	try {
		return JSON.parse(text);
	} catch {
		return fallback;
	}
}
