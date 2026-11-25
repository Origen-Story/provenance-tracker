/**
 * Timeline format registry, mirroring the platform-parser registry in
 * packages/core/src/extraction/parsers/index.js.
 *
 * Each module exports `id`, `label`, `detect(xmlText)` and `parse(xmlText,
 * { sequence })` returning the normalised timeline shape documented in
 * ./xmeml.js, and, when a file can hold several sequences, `sequences(xmlText)`. To add a
 * format (FCPXML, EDL): write the module, register it here, commit a small
 * fixture under test/fixtures/timeline and a test.
 */
import * as xmeml from "./xmeml.js";

export const formats = [xmeml];

export function detectFormat(text) {
	return formats.find((f) => f.detect(text)) || null;
}

function formatOf(text) {
	const format = detectFormat(text);
	if (!format)
		throw new Error(
			`Unrecognised timeline format (known: ${formats.map((f) => f.id).join(", ")})`,
		);
	return format;
}

/**
 * Parse a timeline file; `opts.sequence` picks one of its sequences by its
 * index in listSequences (the first by default).
 */
export function parseTimeline(text, opts = {}) {
	return formatOf(text).parse(text, opts);
}

/**
 * The sequences a timeline file holds: { index, name, durationFrames, fps,
 * seconds }. A format that holds one sequence per file need not say.
 */
export function listSequences(text) {
	const format = formatOf(text);
	if (format.sequences) return format.sequences(text);
	const { sequence } = format.parse(text);
	return [
		{
			index: 0,
			name: sequence.name ?? "",
			durationFrames: sequence.durationFrames ?? null,
			fps: sequence.fps ?? null,
			seconds:
				sequence.fps && sequence.durationFrames != null
					? sequence.durationFrames / sequence.fps
					: null,
		},
	];
}
