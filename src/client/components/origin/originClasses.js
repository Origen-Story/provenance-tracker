// How the UI shows the origin vocabulary (decision D11). The vocabulary
// itself, with labels, spectrum positions and the IPTC codes, is shared with
// the server in src/shared/origin-vocabulary.js; this file adds colour and
// the wording of explanations.
//
// Colour belongs to the spectrum position, not the class, and comes from six
// CSS custom properties in app.css (--pt-origin-<position>). Nothing here
// names a Tailwind colour class, so no class name is ever built at runtime.
import { ORIGIN_CLASS_DEFS, POSITIONS, originClassDef, positionDef, spectrumPosition, describeOrigin, SIGNED_BY_LABELS } from '../../../shared/origin-vocabulary.js';

export { ORIGIN_CLASS_DEFS, POSITIONS, originClassDef, positionDef, spectrumPosition, describeOrigin, SIGNED_BY_LABELS };

export const positionColor = (position) => `var(--pt-origin-${positionDef(position).id})`;

// Everything a badge or a row needs to show an asset's origin.
export function originInfo({ originClass, aiAssisted = false } = {}) {
	const def = originClassDef(originClass);
	const position = spectrumPosition(def.code, { aiAssisted });
	const assisted = aiAssisted && def.position === 'digital';
	return {
		...def,
		position,
		positionLabel: positionDef(position).label,
		color: positionColor(position),
		label: describeOrigin({ originClass: def.code, aiAssisted }),
		short: assisted ? `${def.short} · AI-assisted` : def.short,
		aiAssisted: assisted
	};
}

// Inline style for a pill in a position's colour: a tinted fill, a firmer
// border, and text pulled toward the theme's heading colour so it reads on
// both light and dark cards.
export function pillStyle(position) {
	const c = positionColor(position);
	return {
		backgroundColor: `color-mix(in srgb, ${c} 20%, transparent)`,
		borderColor: `color-mix(in srgb, ${c} 55%, transparent)`,
		color: `color-mix(in srgb, ${c} 60%, var(--os-heading))`
	};
}

// Composition strip states that are not positions (decision D10).
export const MIXED = { label: 'Mixed', desc: 'Two or more spectrum positions play at once: a graphic over a camera shot, a generated bed under captured narration.' };
export const GAP = { label: 'Nothing', desc: 'No clip plays here.' };

// Inline background for a strip interval: solid for one position, diagonal
// stripes of the positions' colours for a mix, a fine hatch for unknown.
export function intervalBackground(positions) {
	const list = [...new Set(positions || [])];
	if (list.length === 0) return 'transparent';
	if (list.length === 1) {
		if (list[0] === 'unknown') return `repeating-linear-gradient(45deg, ${positionColor('unknown')} 0 2px, transparent 2px 6px)`;
		return positionColor(list[0]);
	}
	const step = 7;
	return `repeating-linear-gradient(135deg, ${list.map((p, i) => `${positionColor(p)} ${i * step}px ${(i + 1) * step}px`).join(', ')})`;
}

// Why the classifier proposed what it did, in plain words.
export const SOURCE_EXPLANATIONS = {
	c2pa_capture_action: 'The embedded Content Credentials say a device captured it.',
	c2pa_capture_device: 'Signed by a known camera maker; no source type was written.',
	c2pa_ingredients: 'The Content Credentials list other assets placed into this one: it is an edit or export.',
	c2pa_generated_action: 'The embedded Content Credentials say a generative model made it.',
	c2pa_generated_from_empty: 'The Content Credentials start from an empty canvas that a generative model filled.',
	c2pa_declared: 'The embedded Content Credentials declare this source type.',
	modifier_enhanced: 'An enhancer tool output linked to its source.',
	modifier_of_generated: 'An enhancer tool output whose source is itself AI-generated or a composite with AI, so it stays what the source is.',
	modifier_of_unknown: 'An enhancer tool output whose linked source has no class yet. Classify the source first.',
	modifier_unlinked: 'An enhancer tool output with no linked source yet. Set what it was made from below.',
	xmp_digital_source_type: 'An XMP/IPTC digital source type tag, written by the tool that saved it (unsigned).',
	xmp_credit: 'A credit line naming an AI service (unsigned).',
	table_archival: 'Filed under Archival with no other signal, so assumed to be a scan. Check it.',
	table_produced: 'Filed under Produced with no other signal, so assumed to be a recording.',
	platform_parser: 'A platform parser recognised the generator.',
	timeline_composition: 'Worked out from the imported timeline: what the clips in this edit are.',
	no_signal: 'Nothing in the file says where it came from.',
	user: 'Set by you.',
	// Rule names written before D11, still on rows that were never re-proposed.
	modifier_of_archival: 'An enhancer tool output linked to an archival source.'
};

export function explainSource(source) {
	if (!source) return '';
	if (SOURCE_EXPLANATIONS[source]) return SOURCE_EXPLANATIONS[source];
	if (source.startsWith('modifier_of_')) return 'An enhancer tool output linked to its source.';
	return source;
}

export const DETAIL_PATHS = { ai: '/assets', archival: '/archival', produced: '/produced' };
export const TYPE_LABELS = { ai: 'AI asset', archival: 'Archival', produced: 'Produced' };
