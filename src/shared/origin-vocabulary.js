// Origin vocabulary (decision D11), shared by the server and the client.
// Pure data and functions, no imports.
//
// An asset's origin class is an IPTC Digital Source Type code, the same term
// a C2PA manifest carries as `digitalSourceType`, so nothing is translated
// when a file is read or signed. `unknown` is the tracker's own value for "no
// claim". See docs/vocabulary.md for the definitions.
//
// Three facts are attributes of an asset, not classes:
//   signed by      who vouches for the file (device, tool, creator, nobody)
//   from an archive  the asset's type is `archival`
//   AI-assisted    an AI model wrote the instructions (code, a design file)
//                  and an ordinary program made the pixels
//
// Colour follows the spectrum position, not the class: how much generative AI
// is in the material. Several classes share a position.

export const IPTC_BASE = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

// Spectrum positions, in legend order.
export const POSITIONS = [
	{ id: 'captured', label: 'Camera-captured', long: 'Camera-captured only', desc: 'Recorded from real life by a camera, a microphone or a scanner. No generative AI.' },
	{ id: 'digital', label: 'Digital, no AI', long: 'Digital, no AI', desc: 'Made or recorded on a computer without a generative model: titles, graphics, screen recordings.' },
	{ id: 'assisted', label: 'AI-assisted', long: 'AI-assisted adjustments', desc: 'A model helped, but did not invent the content: an upscale or clean-up, or code an AI wrote that an ordinary program rendered.' },
	{ id: 'hybrid', label: 'Hybrid', long: 'Hybrid generated elements', desc: 'Real and generated material in one asset: a generative edit, or a composite that includes AI.' },
	{ id: 'synthetic', label: 'Fully synthetic', long: 'Fully synthetic', desc: 'Made by a generative model.' },
	{ id: 'unknown', label: 'Unknown', long: 'Not on the spectrum yet', desc: 'Nothing reliable says how this was made.' }
];

// Every accepted class. `picker` marks the short list offered first; the rest
// are stored when a file declares them and offered under "More terms".
// `retired` codes are read from old files and normalised to their successor.
export const ORIGIN_CLASS_DEFS = [
	{ code: 'digitalCapture', label: 'Captured', short: 'Captured', position: 'captured', picker: true, desc: 'Recorded from real life by a camera or microphone.' },
	{ code: 'computationalCapture', label: 'Captured (multi-frame)', short: 'Captured', position: 'captured', desc: 'A capture the device merged from several frames, as phone HDR does. No generative model.' },
	{ code: 'print', label: 'Scanned', short: 'Scanned', position: 'captured', picker: true, desc: 'Digitised from a print or other physical original.' },
	{ code: 'negativeFilm', label: 'Scanned from a negative', short: 'Scanned', position: 'captured', desc: 'Digitised from a film negative.' },
	{ code: 'positiveFilm', label: 'Scanned from a transparency', short: 'Scanned', position: 'captured', desc: 'Digitised from a slide or other positive transparency.' },
	{ code: 'compositeCapture', label: 'Composite, camera only', short: 'Composite, camera', position: 'captured', picker: true, desc: 'Several pieces put together, every one a real capture.' },
	{ code: 'humanEdits', label: 'Human-edited', short: 'Human-edited', position: 'captured', desc: 'Corrected or improved by a person with non-generative tools.' },
	{ code: 'algorithmicallyEnhanced', label: 'AI-enhanced', short: 'AI-enhanced', position: 'assisted', picker: true, desc: 'Upscaled, restored or cleaned by an algorithm without changing what it shows.' },
	{ code: 'compositeWithTrainedAlgorithmicMedia', label: 'Edited with generative AI', short: 'Gen-AI edit', position: 'hybrid', picker: true, desc: 'One asset changed by a generative model: generative fill, a replaced background.' },
	{ code: 'compositeSynthetic', label: 'Composite with AI', short: 'Composite + AI', position: 'hybrid', picker: true, desc: 'Several pieces put together, at least one of them AI-generated.' },
	{ code: 'composite', label: 'Composite', short: 'Composite', position: 'hybrid', desc: 'Several pieces put together; nothing says whether any is AI-generated.' },
	{ code: 'trainedAlgorithmicMedia', label: 'AI-generated', short: 'AI-generated', position: 'synthetic', picker: true, desc: 'Made by a generative model from a prompt or reference.' },
	{ code: 'algorithmicMedia', label: 'Rendered from code', short: 'Rendered', position: 'digital', picker: true, desc: 'Drawn by a program from code or a formula, with no trained model making the pixels.' },
	{ code: 'digitalCreation', label: 'Human-made', short: 'Human-made', position: 'digital', picker: true, desc: 'Made by a person with ordinary software: a title, a logo, music composed in an editor.' },
	{ code: 'screenCapture', label: 'Screen capture', short: 'Screen capture', position: 'digital', picker: true, desc: 'A recording or still of a computer or phone screen.' },
	{ code: 'virtualRecording', label: 'Virtual event recording', short: 'Call recording', position: 'digital', picker: true, desc: 'A recording of a video call, webinar or stream.' },
	{ code: 'dataDrivenMedia', label: 'Data-driven', short: 'Data-driven', position: 'digital', desc: 'A chart, map or other picture of data, made by programming.' },
	{ code: 'unknown', label: 'Unknown', short: 'Unknown', position: 'unknown', picker: true, desc: 'No reliable signal yet; set it by hand.' }
];

export const RETIRED_SOURCE_TYPES = { minorHumanEdits: 'humanEdits', digitalArt: 'digitalCreation', softwareImage: 'algorithmicMedia' };

// C2PA's own source types (http://c2pa.org/digitalsourcetype/...). Not
// classes: `empty` is a blank canvas, read as a signal by the classifier.
export const C2PA_SOURCE_TYPES = ['empty', 'trainedAlgorithmicData'];

export const ORIGIN_CLASSES = ORIGIN_CLASS_DEFS.map(c => c.code);
export const SIGNED_BY = ['', 'device', 'tool', 'creator'];
export const SIGNED_BY_LABELS = { device: 'the capture device', tool: 'the tool that made it', creator: 'the creator, at ingest' };

const BY_CODE = new Map(ORIGIN_CLASS_DEFS.map(c => [c.code, c]));
const POSITION_BY_ID = new Map(POSITIONS.map(p => [p.id, p]));

export function originClassDef(code) {
	return BY_CODE.get(code) || BY_CODE.get('unknown');
}

export function positionDef(id) {
	return POSITION_BY_ID.get(id) || POSITION_BY_ID.get('unknown');
}

/**
 * Turn anything a file may carry (a full IPTC or C2PA URI, a bare code, a
 * retired code, different capitalisation) into an accepted class code, the
 * string `empty` for C2PA's blank canvas, or null when it is not a source type.
 */
export function normalizeSourceType(value) {
	const tail = String(value || '').trim().split(/[\/#]/).pop();
	if (!tail) return null;
	const lower = tail.toLowerCase();
	if (lower === 'empty') return 'empty';
	for (const [old, now] of Object.entries(RETIRED_SOURCE_TYPES)) if (old.toLowerCase() === lower) return now;
	for (const c of ORIGIN_CLASS_DEFS) if (c.code !== 'unknown' && c.code.toLowerCase() === lower) return c.code;
	return null;
}

// The IPTC URI to write into a manifest for a class; null for `unknown`.
export function sourceTypeUri(code) {
	return BY_CODE.has(code) && code !== 'unknown' ? `${IPTC_BASE}${code}` : null;
}

/**
 * Where an asset sits on the spectrum. The AI-assisted flag moves digital
 * work with no AI in its pixels to the AI-assisted position; it changes
 * nothing else, because a capture or a generated clip is already placed by
 * what its pixels are.
 */
export function spectrumPosition(code, { aiAssisted = false } = {}) {
	const position = originClassDef(code).position;
	return position === 'digital' && aiAssisted ? 'assisted' : position;
}

/**
 * The class of a finished edit, from the spectrum positions of what is in it:
 * all captures is a camera-only composite, anything generated or hybrid makes
 * it a composite with AI, and otherwise the mix is left unqualified.
 */
export function compositeClassFor(positions) {
	const set = new Set((positions || []).filter(Boolean));
	if (set.size === 0) return 'composite';
	if (set.has('synthetic') || set.has('hybrid')) return 'compositeSynthetic';
	if ([...set].every(p => p === 'captured')) return 'compositeCapture';
	return 'composite';
}

// Label for a class as shown on a badge, with its attributes.
export function describeOrigin({ originClass, aiAssisted = false } = {}) {
	const def = originClassDef(originClass);
	return aiAssisted && def.position === 'digital' ? `${def.label}, AI-assisted` : def.label;
}

// Values of the vocabulary before D11, for the one-off data migration and
// for reading rows or exports written before it.
export const LEGACY_CLASS_MAP = {
	captured_signed: 'digitalCapture',
	captured: 'digitalCapture',
	archival: 'print',
	archival_enhanced: 'algorithmicallyEnhanced',
	generated: 'trainedAlgorithmicMedia',
	composited: 'composite',
	unknown: 'unknown'
};
