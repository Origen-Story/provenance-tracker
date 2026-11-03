// Origin-class vocabulary (decision D3) as the UI shows it. Keep in step with
// src/server/lib/origin/classify.js ORIGIN_CLASSES.
export const ORIGIN_CLASSES = [
	{ value: 'captured_signed', label: 'Captured (signed)', short: 'Captured ✓', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', desc: 'Recorded by a camera or phone that signed it with Content Credentials.' },
	{ value: 'captured', label: 'Captured', short: 'Captured', color: 'bg-green-500/20 text-green-300 border-green-500/40', desc: 'Recorded by a camera or microphone, no signature.' },
	{ value: 'archival', label: 'Archival', short: 'Archival', color: 'bg-amber-500/20 text-amber-200 border-amber-500/40', desc: 'Historical material from an archive, unchanged.' },
	{ value: 'archival_enhanced', label: 'Archival, AI-enhanced', short: 'Archival + AI', color: 'bg-orange-500/20 text-orange-200 border-orange-500/40', desc: 'Archival material upscaled, restored or colourised with an AI tool.' },
	{ value: 'generated', label: 'AI-generated', short: 'Generated', color: 'bg-purple-500/20 text-purple-200 border-purple-500/40', desc: 'Made by a generative model from a prompt or reference.' },
	{ value: 'composited', label: 'Composited', short: 'Composited', color: 'bg-sky-500/20 text-sky-200 border-sky-500/40', desc: 'An edit or export made from several other assets.' },
	{ value: 'unknown', label: 'Unknown', short: 'Unknown', color: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40', desc: 'No reliable signal yet; set it by hand.' }
];

export function originClassInfo(value) {
	return ORIGIN_CLASSES.find(c => c.value === value) || ORIGIN_CLASSES[ORIGIN_CLASSES.length - 1];
}

// Why the classifier proposed what it did, in plain words.
export const SOURCE_EXPLANATIONS = {
	c2pa_capture_action: 'The embedded Content Credentials say the device captured it.',
	c2pa_capture_device: 'Signed by a known camera maker; no capture action was written.',
	c2pa_ingredients: 'The Content Credentials list other assets as ingredients: this is an edit or export.',
	modifier_of_archival: 'An enhancer tool output linked to an archival source.',
	modifier_of_generated: 'An enhancer tool output linked to an AI-generated source.',
	modifier_unlinked: 'An enhancer tool output (Topaz) with no linked source yet. Set its parent below.',
	c2pa_generated_action: 'The embedded Content Credentials say a generative model made it.',
	xmp_digital_source_type: 'An XMP/IPTC digital source type tag, written by the tool that saved it (unsigned).',
	xmp_credit: 'A credit line naming an AI service (unsigned).',
	table_archival: 'Filed under Archival, with no other signal.',
	table_produced: 'Filed under Produced, with no capture signature.',
	platform_parser: 'A platform parser recognised the generator.',
	no_signal: 'Nothing in the file says where it came from.',
	user: 'Set by you.'
};

export function explainSource(source) {
	if (!source) return '';
	if (SOURCE_EXPLANATIONS[source]) return SOURCE_EXPLANATIONS[source];
	if (source.startsWith('modifier_of_')) return `An enhancer tool output whose source is ${source.replace('modifier_of_', '').replace('_', ' ')}; there is no class for an enhanced capture, so review it.`;
	return source;
}

export const DETAIL_PATHS = { ai: '/assets', archival: '/archival', produced: '/produced' };
export const TYPE_LABELS = { ai: 'AI asset', archival: 'Archival', produced: 'Produced' };
