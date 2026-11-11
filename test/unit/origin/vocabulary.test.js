import { describe, it, expect } from 'vitest';
import {
	ORIGIN_CLASS_DEFS, ORIGIN_CLASSES, POSITIONS, RETIRED_SOURCE_TYPES, LEGACY_CLASS_MAP,
	normalizeSourceType, sourceTypeUri, spectrumPosition, compositeClassFor, describeOrigin, originClassDef, positionDef
} from '../../../src/shared/origin-vocabulary.js';

// The 17 active terms of the IPTC Digital Source Type vocabulary, as read
// from cv.iptc.org on 2026-11-11 (docs/vocabulary.md).
const IPTC_ACTIVE = [
	'digitalCapture', 'computationalCapture', 'negativeFilm', 'positiveFilm', 'print', 'humanEdits',
	'compositeWithTrainedAlgorithmicMedia', 'algorithmicallyEnhanced', 'digitalCreation', 'dataDrivenMedia',
	'trainedAlgorithmicMedia', 'algorithmicMedia', 'screenCapture', 'virtualRecording',
	'composite', 'compositeCapture', 'compositeSynthetic'
];

describe('origin vocabulary', () => {
	it('is every active IPTC term plus unknown, each with a label and a known position', () => {
		expect([...ORIGIN_CLASSES].sort()).toEqual([...IPTC_ACTIVE, 'unknown'].sort());
		const positions = POSITIONS.map(p => p.id);
		for (const c of ORIGIN_CLASS_DEFS) {
			expect(c.label, c.code).toBeTruthy();
			expect(c.short, c.code).toBeTruthy();
			expect(positions, c.code).toContain(c.position);
		}
	});
	it('offers a short list first, one class per label', () => {
		const picker = ORIGIN_CLASS_DEFS.filter(c => c.picker);
		expect(picker.map(c => c.label)).toEqual(['Captured', 'Scanned', 'Composite, camera only', 'AI-enhanced', 'Edited with generative AI', 'Composite with AI', 'AI-generated', 'Rendered from code', 'Human-made', 'Screen capture', 'Virtual event recording', 'Unknown']);
	});
	it('maps every pre-D11 class to a current one', () => {
		expect(Object.keys(LEGACY_CLASS_MAP).sort()).toEqual(['archival', 'archival_enhanced', 'captured', 'captured_signed', 'composited', 'generated', 'unknown']);
		for (const code of Object.values(LEGACY_CLASS_MAP)) expect(ORIGIN_CLASSES).toContain(code);
	});
});

describe('normalizeSourceType', () => {
	it('accepts URIs, bare codes and any capitalisation', () => {
		expect(normalizeSourceType('http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia')).toBe('trainedAlgorithmicMedia');
		expect(normalizeSourceType('digitalcapture')).toBe('digitalCapture');
		expect(normalizeSourceType(' screenCapture ')).toBe('screenCapture');
	});
	it('reads retired codes as their successors and recognises the C2PA empty canvas', () => {
		for (const [old, now] of Object.entries(RETIRED_SOURCE_TYPES)) expect(normalizeSourceType(`http://cv.iptc.org/newscodes/digitalsourcetype/${old}`)).toBe(now);
		expect(normalizeSourceType('http://c2pa.org/digitalsourcetype/empty')).toBe('empty');
	});
	it('rejects anything else, including the tracker-only unknown', () => {
		expect(normalizeSourceType('')).toBeNull();
		expect(normalizeSourceType(undefined)).toBeNull();
		expect(normalizeSourceType('unknown')).toBeNull();
		expect(normalizeSourceType('captured_signed')).toBeNull();
	});
});

describe('sourceTypeUri', () => {
	it('gives the IPTC URI to write into a manifest', () => {
		expect(sourceTypeUri('algorithmicMedia')).toBe('http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia');
		expect(sourceTypeUri('unknown')).toBeNull();
		expect(sourceTypeUri('nope')).toBeNull();
	});
});

describe('spectrumPosition', () => {
	it('places classes by how much generative AI is in them', () => {
		expect(spectrumPosition('computationalCapture')).toBe('captured');
		expect(spectrumPosition('print')).toBe('captured');
		expect(spectrumPosition('compositeCapture')).toBe('captured');
		expect(spectrumPosition('algorithmicallyEnhanced')).toBe('assisted');
		expect(spectrumPosition('compositeWithTrainedAlgorithmicMedia')).toBe('hybrid');
		expect(spectrumPosition('compositeSynthetic')).toBe('hybrid');
		expect(spectrumPosition('trainedAlgorithmicMedia')).toBe('synthetic');
		expect(spectrumPosition('screenCapture')).toBe('digital');
		expect(spectrumPosition('unknown')).toBe('unknown');
		expect(spectrumPosition('not-a-class')).toBe('unknown');
	});
	it('the AI-assisted flag moves digital work, and only digital work', () => {
		expect(spectrumPosition('algorithmicMedia', { aiAssisted: true })).toBe('assisted');
		expect(spectrumPosition('digitalCreation', { aiAssisted: true })).toBe('assisted');
		expect(spectrumPosition('digitalCapture', { aiAssisted: true })).toBe('captured');
		expect(spectrumPosition('trainedAlgorithmicMedia', { aiAssisted: true })).toBe('synthetic');
		expect(describeOrigin({ originClass: 'algorithmicMedia', aiAssisted: true })).toBe('Rendered from code, AI-assisted');
		expect(describeOrigin({ originClass: 'digitalCapture', aiAssisted: true })).toBe('Captured');
	});
});

describe('compositeClassFor', () => {
	it('names a finished edit from what is in it', () => {
		expect(compositeClassFor(['captured'])).toBe('compositeCapture');
		expect(compositeClassFor(['captured', 'synthetic'])).toBe('compositeSynthetic');
		expect(compositeClassFor(['digital', 'hybrid'])).toBe('compositeSynthetic');
		expect(compositeClassFor(['captured', 'digital'])).toBe('composite');
		expect(compositeClassFor(['captured', 'assisted'])).toBe('composite');
		expect(compositeClassFor(['captured', 'unknown'])).toBe('composite');
		expect(compositeClassFor([])).toBe('composite');
	});
});

describe('lookups', () => {
	it('fall back to unknown', () => {
		expect(originClassDef('nope').code).toBe('unknown');
		expect(positionDef('nope').id).toBe('unknown');
	});
});
