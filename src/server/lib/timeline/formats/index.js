/**
 * Timeline format registry, mirroring the platform-parser registry in
 * src/server/lib/extraction/parsers/index.js.
 *
 * Each module exports `id`, `label`, `detect(xmlText)` and `parse(xmlText)`
 * returning the normalised timeline shape documented in ./xmeml.js. To add a
 * format (FCPXML, EDL): write the module, register it here, commit a small
 * fixture under test/fixtures/timeline and a test.
 */
import * as xmeml from './xmeml.js';

export const formats = [xmeml];

export function detectFormat(text) {
	return formats.find(f => f.detect(text)) || null;
}

export function parseTimeline(text) {
	const format = detectFormat(text);
	if (!format) throw new Error(`Unrecognised timeline format (known: ${formats.map(f => f.id).join(', ')})`);
	return format.parse(text);
}
