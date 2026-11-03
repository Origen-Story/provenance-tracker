import { describe, it, expect } from 'vitest';
import { proposeOriginClass, c2paSignals, ORIGIN_CLASSES, parseJsonSafe } from '../../../src/server/lib/origin/classify.js';

// Summaries shaped like src/server/lib/extraction/c2pa.js buildSummary(),
// taken from real files: a Pixel 10 Pro clip, a Firefly clip, an ElevenLabs
// voice line, and a Premiere 2026 export with four chained ingredients.
const pixel = {
	claimGenerator: 'Google C2PA SDK for Android',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/computationalCapture' }] } }],
	ingredients: [],
	signatureInfo: { issuer: 'Google LLC', commonName: 'Pixel Camera' }
};
const firefly = {
	claimGenerator: 'Adobe_Firefly',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created' }, { action: 'c2pa.edited', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia' }] } }],
	ingredients: [],
	signatureInfo: { issuer: 'Adobe Inc.', commonName: 'Adobe Firefly C2PA' }
};
const elevenlabs = {
	claimGenerator: 'c2pa-rs 0.67.1',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' }] } }],
	ingredients: [],
	signatureInfo: { issuer: 'Eleven Labs Inc.', commonName: 'Eleven Labs Inc.' }
};
const premiereExport = {
	claimGenerator: 'Adobe Premiere Pro 26.5.2',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia' }, { action: 'c2pa.placed' }] } }],
	ingredients: [{ title: 'a.wav', relationship: 'componentOf' }, { title: 'b.mp4', relationship: 'componentOf' }],
	signatureInfo: { issuer: 'Adobe Inc.', commonName: 'Adobe Premiere' }
};

describe('c2paSignals', () => {
	it('flattens actions and source types', () => {
		const s = c2paSignals(firefly);
		expect(s.hasManifest).toBe(true);
		expect(s.sourceTypes).toEqual(['compositeWithTrainedAlgorithmicMedia']);
		expect(s.issuer).toBe('Adobe Inc.');
	});
	it('treats a read error blob as no manifest', () => {
		expect(c2paSignals({ _readError: true }).hasManifest).toBe(false);
		expect(c2paSignals(null).hasManifest).toBe(false);
	});
});

describe('proposeOriginClass', () => {
	it('exposes the D3 vocabulary', () => {
		expect(ORIGIN_CLASSES).toContain('captured_signed');
		expect(ORIGIN_CLASSES).toContain('archival_enhanced');
		expect(ORIGIN_CLASSES.length).toBe(7);
	});

	it('signed capture wins regardless of table', () => {
		const r = proposeOriginClass({ table: 'produced', c2paSummary: pixel });
		expect(r).toEqual({ originClass: 'captured_signed', source: 'c2pa_capture_action', captureSigned: true });
		expect(proposeOriginClass({ table: 'ai', c2paSummary: pixel }).originClass).toBe('captured_signed');
	});

	it('a known capture device signer counts when no source type is written', () => {
		const leica = { claimGenerator: 'Leica M11-P', assertions: [], ingredients: [], signatureInfo: { issuer: 'Leica Camera AG', commonName: 'Leica' } };
		expect(proposeOriginClass({ table: 'produced', c2paSummary: leica }).source).toBe('c2pa_capture_device');
	});

	it('an NLE export with ingredients is composited', () => {
		const r = proposeOriginClass({ table: 'produced', c2paSummary: premiereExport });
		expect(r.originClass).toBe('composited');
		expect(r.source).toBe('c2pa_ingredients');
	});

	it('signed generation is generated, whichever table it was filed in', () => {
		expect(proposeOriginClass({ table: 'ai', c2paSummary: firefly, platform: 'firefly' }).source).toBe('c2pa_generated_action');
		expect(proposeOriginClass({ table: 'produced', c2paSummary: elevenlabs }).originClass).toBe('generated');
	});

	it('a modifier follows its parent and is unknown when unlinked', () => {
		const topaz = { table: 'ai', platform: 'topaz-video-ai', platformData: { assetClass: 'modifier' } };
		expect(proposeOriginClass({ ...topaz, parentClass: 'archival' })).toMatchObject({ originClass: 'archival_enhanced', source: 'modifier_of_archival' });
		expect(proposeOriginClass({ ...topaz, parentClass: 'generated' })).toMatchObject({ originClass: 'generated' });
		expect(proposeOriginClass({ ...topaz, parentClass: 'captured_signed' })).toMatchObject({ originClass: 'unknown', source: 'modifier_of_captured_signed' });
		expect(proposeOriginClass(topaz)).toMatchObject({ originClass: 'unknown', source: 'modifier_unlinked' });
		// otherParams nesting, as the platform blob stores it
		expect(proposeOriginClass({ table: 'ai', platform: 'topaz-video-ai', platformData: { otherParams: { assetClass: 'modifier' } } }).source).toBe('modifier_unlinked');
	});

	it('unsigned XMP hints classify generated and captured', () => {
		const gigapixel = { DigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia', Software: 'Topaz Gigapixel 1.1.2 (Windows)' };
		expect(proposeOriginClass({ table: 'ai', platform: 'unknown', exifTags: gigapixel }).source).toBe('xmp_digital_source_type');
		expect(proposeOriginClass({ table: 'ai', platform: 'unknown', exifTags: { Credit: 'Made with Google AI' } })).toMatchObject({ originClass: 'generated', source: 'xmp_credit' });
		expect(proposeOriginClass({ table: 'produced', exifTags: { DigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture' } })).toMatchObject({ originClass: 'captured', source: 'xmp_digital_source_type' });
	});

	it('falls back to the table', () => {
		expect(proposeOriginClass({ table: 'archival' })).toMatchObject({ originClass: 'archival', source: 'table_archival' });
		expect(proposeOriginClass({ table: 'produced' })).toMatchObject({ originClass: 'captured', source: 'table_produced' });
		expect(proposeOriginClass({ table: 'ai', platform: 'freepik' })).toMatchObject({ originClass: 'generated', source: 'platform_parser' });
		expect(proposeOriginClass({ table: 'ai', platform: 'unknown' })).toMatchObject({ originClass: 'unknown', source: 'no_signal' });
	});

	it('ignores a C2PA blob that recorded a read error', () => {
		expect(proposeOriginClass({ table: 'produced', c2paSummary: { _readError: true, validationStatus: [] } }).source).toBe('table_produced');
	});
});

describe('parseJsonSafe', () => {
	it('returns the fallback on bad input', () => {
		expect(parseJsonSafe('{"a":1}')).toEqual({ a: 1 });
		expect(parseJsonSafe('nope', {})).toEqual({});
		expect(parseJsonSafe(null)).toBeNull();
	});
});
