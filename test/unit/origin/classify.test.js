import { describe, it, expect } from 'vitest';
import { proposeOriginClass, c2paSignals, signerOf, ORIGIN_CLASSES, parseJsonSafe } from '../../../src/server/lib/origin/classify.js';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

// Summaries shaped like src/server/lib/extraction/c2pa.js buildSummary(),
// taken from real files: a Pixel 10 Pro clip, a Firefly clip, an ElevenLabs
// voice line, and a Premiere 2026 export with placed ingredients.
const pixel = {
	claimGenerator: 'Google C2PA SDK for Android',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: `${IPTC}computationalCapture` }] } }],
	ingredients: [],
	signatureInfo: { issuer: 'Google LLC', commonName: 'Pixel Camera' }
};
const firefly = {
	claimGenerator: 'Adobe_Firefly',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://c2pa.org/digitalsourcetype/empty' }, { action: 'c2pa.edited', digitalSourceType: `${IPTC}compositeWithTrainedAlgorithmicMedia` }] } }],
	ingredients: [],
	signatureInfo: { issuer: 'Adobe Inc.', commonName: 'Adobe Firefly C2PA' }
};
const elevenlabs = {
	claimGenerator: 'c2pa-rs 0.67.1',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: `${IPTC}trainedAlgorithmicMedia` }] } }],
	ingredients: [],
	signatureInfo: { issuer: 'Eleven Labs Inc.', commonName: 'Eleven Labs Inc.' }
};
const premiereExport = {
	claimGenerator: 'Adobe Premiere Pro 26.5.2',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: `${IPTC}compositeWithTrainedAlgorithmicMedia` }, { action: 'c2pa.placed' }] } }],
	ingredients: [{ title: 'a.wav', relationship: 'componentOf' }, { title: 'b.mp4', relationship: 'componentOf' }],
	signatureInfo: { issuer: 'Adobe Inc.', commonName: 'Adobe Premiere' }
};
const created = (code, extra = {}) => ({
	claimGenerator: 'Some Tool 1.0',
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: code ? `${IPTC}${code}` : undefined }] } }],
	ingredients: [],
	signatureInfo: { issuer: 'Some Tool Ltd', commonName: 'Some Tool' },
	...extra
});

describe('c2paSignals', () => {
	it('flattens actions and normalises source types', () => {
		const s = c2paSignals(firefly);
		expect(s.hasManifest).toBe(true);
		expect(s.createdType).toBe('empty');
		expect(s.sourceTypes).toEqual(['empty', 'compositeWithTrainedAlgorithmicMedia']);
		expect(s.issuer).toBe('Adobe Inc.');
	});
	it('counts component ingredients apart from a parent', () => {
		expect(c2paSignals(premiereExport)).toMatchObject({ ingredients: 2, components: 2, placed: true });
		expect(c2paSignals(created('digitalCapture', { ingredients: [{ title: 'self.wav', relationship: 'parentOf' }] }))).toMatchObject({ ingredients: 1, components: 0, placed: false });
	});
	it('treats a read error blob as no manifest', () => {
		expect(c2paSignals({ _readError: true }).hasManifest).toBe(false);
		expect(c2paSignals(null).hasManifest).toBe(false);
	});
});

describe('signerOf', () => {
	it('tells device, tool and creator apart', () => {
		expect(signerOf(c2paSignals(pixel))).toEqual({ signedBy: 'device', signerName: 'Pixel Camera' });
		expect(signerOf(c2paSignals(elevenlabs))).toEqual({ signedBy: 'tool', signerName: 'Eleven Labs Inc.' });
		const ingest = created('digitalCapture', { claimGenerator: 'c2patool/0.27.1', signatureInfo: { issuer: 'A Studio', commonName: 'A Studio Signing Cert' } });
		expect(signerOf(c2paSignals(ingest))).toEqual({ signedBy: 'creator', signerName: 'A Studio Signing Cert' });
		expect(signerOf(c2paSignals(elevenlabs), ['eleven labs inc.']).signedBy).toBe('creator');
		expect(signerOf(c2paSignals(null))).toEqual({ signedBy: '', signerName: '' });
	});
});

describe('proposeOriginClass', () => {
	it('uses the IPTC codes as the vocabulary', () => {
		expect(ORIGIN_CLASSES).toContain('digitalCapture');
		expect(ORIGIN_CLASSES).toContain('trainedAlgorithmicMedia');
		expect(ORIGIN_CLASSES).toContain('unknown');
		expect(ORIGIN_CLASSES).not.toContain('captured_signed');
	});

	it('keeps the term a signed capture declares, whichever table it is in', () => {
		expect(proposeOriginClass({ table: 'produced', c2paSummary: pixel })).toEqual({ originClass: 'computationalCapture', source: 'c2pa_capture_action', signedBy: 'device', signerName: 'Pixel Camera', captureSigned: true });
		expect(proposeOriginClass({ table: 'ai', c2paSummary: pixel }).originClass).toBe('computationalCapture');
	});

	it('a known capture device signer counts when no source type is written', () => {
		const leica = { claimGenerator: 'Leica M11-P', assertions: [], ingredients: [], signatureInfo: { issuer: 'Leica Camera AG', commonName: 'Leica' } };
		expect(proposeOriginClass({ table: 'produced', c2paSummary: leica })).toMatchObject({ originClass: 'digitalCapture', source: 'c2pa_capture_device', signedBy: 'device' });
	});

	it('an export with placed ingredients is a composite, whatever single-asset term the tool wrote', () => {
		expect(proposeOriginClass({ table: 'produced', c2paSummary: premiereExport })).toMatchObject({ originClass: 'compositeSynthetic', source: 'c2pa_ingredients', signedBy: 'tool', captureSigned: false });
		const plain = { ...premiereExport, assertions: [{ label: 'c2pa.actions', data: { actions: [{ action: 'c2pa.created' }, { action: 'c2pa.placed' }] } }] };
		expect(proposeOriginClass({ table: 'produced', c2paSummary: plain }).originClass).toBe('composite');
		const declared = created('compositeCapture', { ingredients: [{ relationship: 'componentOf' }] });
		expect(proposeOriginClass({ table: 'produced', c2paSummary: declared }).originClass).toBe('compositeCapture');
	});

	it('a file re-signed over its own parent is not a composite', () => {
		const resigned = created('digitalCapture', { claimGenerator: 'c2patool/0.27.1', ingredients: [{ title: 'take.wav', relationship: 'parentOf' }] });
		expect(proposeOriginClass({ table: 'produced', c2paSummary: resigned })).toMatchObject({ originClass: 'digitalCapture', source: 'c2pa_capture_action', signedBy: 'creator', captureSigned: false });
	});

	it('an empty canvas filled by a generative model is AI-generated', () => {
		expect(proposeOriginClass({ table: 'ai', c2paSummary: firefly, platform: 'firefly' })).toMatchObject({ originClass: 'trainedAlgorithmicMedia', source: 'c2pa_generated_from_empty', signedBy: 'tool' });
	});

	it('passes a declared term through', () => {
		expect(proposeOriginClass({ table: 'produced', c2paSummary: elevenlabs })).toMatchObject({ originClass: 'trainedAlgorithmicMedia', source: 'c2pa_generated_action' });
		expect(proposeOriginClass({ table: 'ai', c2paSummary: created('screenCapture') })).toMatchObject({ originClass: 'screenCapture', source: 'c2pa_declared' });
		expect(proposeOriginClass({ table: 'ai', c2paSummary: created('compositeWithTrainedAlgorithmicMedia') }).originClass).toBe('compositeWithTrainedAlgorithmicMedia');
		// retired codes are read as their successor
		expect(proposeOriginClass({ table: 'ai', c2paSummary: created('digitalArt') }).originClass).toBe('digitalCreation');
	});

	it('a signed file with no usable claim falls through, keeping who signed it', () => {
		expect(proposeOriginClass({ table: 'produced', c2paSummary: created(null) })).toMatchObject({ originClass: 'digitalCapture', source: 'table_produced', signedBy: 'tool', signerName: 'Some Tool' });
	});

	it('an enhancer output is AI-enhanced, stays generated over a generated source, and is unknown when unlinked', () => {
		const topaz = { table: 'ai', platform: 'topaz-video-ai', platformData: { assetClass: 'modifier' } };
		expect(proposeOriginClass({ ...topaz, parentClass: 'print' })).toMatchObject({ originClass: 'algorithmicallyEnhanced', source: 'modifier_enhanced' });
		expect(proposeOriginClass({ ...topaz, parentClass: 'computationalCapture' })).toMatchObject({ originClass: 'algorithmicallyEnhanced' });
		expect(proposeOriginClass({ ...topaz, parentClass: 'trainedAlgorithmicMedia' })).toMatchObject({ originClass: 'trainedAlgorithmicMedia', source: 'modifier_of_generated' });
		expect(proposeOriginClass({ ...topaz, parentClass: 'compositeSynthetic' })).toMatchObject({ originClass: 'compositeSynthetic', source: 'modifier_of_generated' });
		expect(proposeOriginClass({ ...topaz, parentClass: 'unknown' })).toMatchObject({ originClass: 'unknown', source: 'modifier_of_unknown' });
		expect(proposeOriginClass(topaz)).toMatchObject({ originClass: 'unknown', source: 'modifier_unlinked' });
		// otherParams nesting, as the platform blob stores it
		expect(proposeOriginClass({ table: 'ai', platform: 'topaz-video-ai', platformData: { otherParams: { assetClass: 'modifier' } } }).source).toBe('modifier_unlinked');
	});

	it('unsigned XMP hints pass their term through', () => {
		const gigapixel = { DigitalSourceType: `${IPTC}trainedAlgorithmicMedia`, Software: 'Topaz Gigapixel 1.1.2 (Windows)' };
		expect(proposeOriginClass({ table: 'ai', platform: 'unknown', exifTags: gigapixel })).toMatchObject({ originClass: 'trainedAlgorithmicMedia', source: 'xmp_digital_source_type', signedBy: '' });
		expect(proposeOriginClass({ table: 'ai', platform: 'unknown', exifTags: { Credit: 'Made with Google AI' } })).toMatchObject({ originClass: 'trainedAlgorithmicMedia', source: 'xmp_credit' });
		expect(proposeOriginClass({ table: 'produced', exifTags: { DigitalSourceType: `${IPTC}digitalCapture` } })).toMatchObject({ originClass: 'digitalCapture', source: 'xmp_digital_source_type' });
		expect(proposeOriginClass({ table: 'archival', exifTags: { DigitalSourceType: 'negativeFilm' } }).originClass).toBe('negativeFilm');
	});

	it('falls back to the table', () => {
		expect(proposeOriginClass({ table: 'archival' })).toMatchObject({ originClass: 'print', source: 'table_archival' });
		expect(proposeOriginClass({ table: 'produced' })).toMatchObject({ originClass: 'digitalCapture', source: 'table_produced' });
		expect(proposeOriginClass({ table: 'ai', platform: 'freepik' })).toMatchObject({ originClass: 'trainedAlgorithmicMedia', source: 'platform_parser' });
		expect(proposeOriginClass({ table: 'ai', platform: 'unknown' })).toMatchObject({ originClass: 'unknown', source: 'no_signal' });
	});

	it('ignores a C2PA blob that recorded a read error', () => {
		expect(proposeOriginClass({ table: 'produced', c2paSummary: { _readError: true, validationStatus: [] } })).toMatchObject({ source: 'table_produced', signedBy: '' });
	});
});

describe('parseJsonSafe', () => {
	it('returns the fallback on bad input', () => {
		expect(parseJsonSafe('{"a":1}')).toEqual({ a: 1 });
		expect(parseJsonSafe('nope', {})).toEqual({});
		expect(parseJsonSafe(null)).toBeNull();
	});
});

describe('classClaimedByFile', () => {
	it('reports no credentials, unreadable ones, or the class a manifest declares', async () => {
		const { classClaimedByFile } = await import('../../../src/server/lib/origin/classify.js');
		expect(classClaimedByFile(null)).toEqual({ credentials: 'none', originClass: null });
		expect(classClaimedByFile({ _readError: true })).toEqual({ credentials: 'unreadable', originClass: null });
		expect(classClaimedByFile(pixel)).toEqual({ credentials: 'present', originClass: 'computationalCapture' });
		expect(classClaimedByFile({ claimGenerator: 'Some Tool', assertions: [], ingredients: [] })).toEqual({ credentials: 'present', originClass: null });
	});
});

describe('a re-signed edit (the tracker\'s own output)', () => {
	it('keeps the composite class it declares on the opened action', () => {
		const ownOutput = {
			claimGenerator: 'provenance-tracker',
			assertions: [{ label: 'c2pa.actions.v2', data: { actions: [
				{ action: 'c2pa.opened', digitalSourceType: `${IPTC}compositeCapture` },
				{ action: 'c2pa.placed', digitalSourceType: `${IPTC}computationalCapture` }
			] } }],
			ingredients: [{ title: 'final.mp4', relationship: 'parentOf' }, { title: 'take.mp4', relationship: 'componentOf' }],
			signatureInfo: { issuer: 'Example Org', commonName: 'Example Dev Cert' }
		};
		expect(proposeOriginClass({ table: 'produced', c2paSummary: ownOutput })).toMatchObject({ originClass: 'compositeCapture', source: 'c2pa_ingredients', signedBy: 'creator' });
	});
});
