import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildOutputManifest } from '../../../src/server/lib/manifest/build.js';
import { buildPublicExport, publicExportFileName, matchReadBack, EXPORT_FORMAT, EXPORT_FORMAT_VERSION } from '../../../src/server/lib/manifest/public-export.js';
import { validate } from '../../helpers/json-schema-lite.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SCHEMA = JSON.parse(readFileSync(path.join(ROOT, 'schemas', 'public-export.v1.schema.json'), 'utf8'));
const GENERATOR = { name: 'provenance-tracker', version: '0.0.0-test' };
const dir = path.join(path.sep, 'media', 'project');

// An 8 s edit: a phone take with a public title, then an AI clip, over a
// voice track; one clip on V2 the tracker could not match.
const assets = new Map([
	['produced:11', { filePath: path.join(dir, 'PXL_0001.mp4'), publicTitle: 'Street interview', originClass: 'computationalCapture', originClassConfirmed: true, originClassNote: 'Credentials missing after a phone update.', c2paSummary: null }],
	['ai:21', { filePath: path.join(dir, 'gen-01.mp4'), originClass: 'trainedAlgorithmicMedia', signedBy: 'tool', signerName: 'Gen Tool', c2paSummary: {
		claimGenerator: 'Gen Tool', ingredients: [], assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' }] } }]
	} }],
	['produced:12', { filePath: path.join(dir, 'voice.wav'), originClass: 'digitalCapture', originClassConfirmed: true, c2paSummary: null }]
]);
const seg = (o) => ({ enabled: true, trackKind: 'video', trackIndex: 1, sourceKind: 'file', ...o });
const segments = [
	seg({ startFrame: 0, endFrame: 120, matchedAssetType: 'produced', matchedAssetId: 11 }),
	seg({ startFrame: 120, endFrame: 240, matchedAssetType: 'ai', matchedAssetId: 21 }),
	seg({ trackKind: 'audio', startFrame: 0, endFrame: 240, matchedAssetType: 'produced', matchedAssetId: 12 }),
	seg({ trackIndex: 2, startFrame: 30, endFrame: 60, clipName: 'private-name.mov', startSeconds: 1, endSeconds: 2 })
];
const L = (type, id) => ({ matchedAssetType: type, matchedAssetId: id });
const composition = {
	durationSeconds: 8, fps: 30,
	picture: {
		intervals: [
			{ startSeconds: 0, endSeconds: 1, positions: ['captured'], layers: [L('produced', 11)] },
			{ startSeconds: 1, endSeconds: 2, positions: ['captured', 'unknown'], layers: [{}, L('produced', 11)] },
			{ startSeconds: 2, endSeconds: 4, positions: ['captured'], layers: [L('produced', 11)] },
			{ startSeconds: 4, endSeconds: 8, positions: ['synthetic'], layers: [L('ai', 21)] }
		],
		byPosition: { captured: { seconds: 3, percent: 37.5 }, synthetic: { seconds: 4, percent: 50 } },
		mixed: { seconds: 1, percent: 12.5, combos: { 'captured+unknown': { seconds: 1, percent: 12.5 } } },
		gap: { seconds: 0, percent: 0 }
	},
	audio: {
		intervals: [{ startSeconds: 0, endSeconds: 8, positions: ['captured'], layers: [L('produced', 12)] }],
		byPosition: { captured: { seconds: 8, percent: 100 } }, mixed: { seconds: 0, percent: 0, combos: {} }, gap: { seconds: 0, percent: 0 }
	}
};
const output = { type: 'produced', id: 1, filePath: path.join(dir, 'film.mp4'), publicTitle: 'How This Film Was Made', originClass: 'compositeSynthetic' };
const { statement } = buildOutputManifest({
	output, timeline: { sequenceName: 'Seq', fps: 30 }, composition, segments, assets,
	statement: { text: 'Made with a phone and one AI shot.', authorName: 'A. Creator' }, statedAt: '2026-11-14T09:00:00Z', generator: GENERATOR
});

// A c2patool read-back: valid apart from trust, the AI clip's own manifest carried in.
const report = {
	active_manifest: 'urn:ours',
	manifests: {
		'urn:ours': {
			// c2patool renames ingredients by assertion, in the order given (seen on 0.27.1).
			ingredients: [{ label: 'c2pa.ingredient.v3', title: 'film.mp4', relationship: 'parentOf' }, { label: 'c2pa.ingredient.v3__1', title: 'PXL_0001.mp4', relationship: 'componentOf' }, { label: 'c2pa.ingredient.v3__2', title: 'voice.wav', relationship: 'componentOf' }, { label: 'c2pa.ingredient.v3__3', title: 'gen-01.mp4', relationship: 'componentOf', active_manifest: 'urn:gen' }],
			signature_info: { issuer: 'Dev CA', common_name: 'Dev Signer', alg: 'Es256', time: '2026-11-14T09:00:01Z' }
		},
		'urn:gen': {}
	},
	validation_results: { activeManifest: { success: [{ code: 'assertion.bmffHash.match' }], failure: [{ code: 'signingCredential.untrusted' }] } }
};
const signature = {
	id: 5, kind: 'output', version: 2,
	signedPath: path.join(dir, 'film.signed.v2.mp4'), signedHash: 'ab'.repeat(32), signedSize: 123456789,
	statementJson: JSON.stringify(statement), reportJson: JSON.stringify(report), createdAt: new Date('2026-11-14T09:00:02Z')
};
const e = buildPublicExport({ signature, generatedAt: '2026-11-14T10:00:00Z', generator: GENERATOR });

describe('buildPublicExport', () => {
	it('matches the published schema', () => {
		expect(validate(SCHEMA, e)).toEqual([]);
		expect(e).toMatchObject({ format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION });
	});

	it('names the film and each ingredient by public title, keeping the file name beside it', () => {
		expect(e.film).toMatchObject({ title: 'How This Film Was Made', fileName: 'film.mp4', durationSeconds: 8, position: 'hybrid' });
		expect(e.ingredients.map(i => [i.ref, i.title, i.fileName])).toEqual([
			['ing-1', 'Street interview', 'PXL_0001.mp4'],
			['ing-2', 'voice.wav', 'voice.wav'],
			['ing-3', 'gen-01.mp4', 'gen-01.mp4']
		]);
	});

	it('carries the strip as signed, by ingredient ref', () => {
		expect(e.composition.picture.intervals).toEqual([
			{ start: 0, end: 1, positions: ['captured'], refs: ['ing-1'] },
			{ start: 1, end: 2, positions: ['captured', 'unknown'], refs: ['ing-1'], untracked: 1 },
			{ start: 2, end: 4, positions: ['captured'], refs: ['ing-1'] },
			{ start: 4, end: 8, positions: ['synthetic'], refs: ['ing-3'] }
		]);
		expect(e.composition.audio.byPosition.captured.percent).toBe(100);
	});

	it('says which ingredients kept their own credentials inside the signed file', () => {
		expect(e.ingredients.find(i => i.ref === 'ing-3')).toMatchObject({ credentialsInSignedFile: 'present', fileCredentials: 'present', signerName: 'Gen Tool' });
		expect(e.ingredients.find(i => i.ref === 'ing-1')).toMatchObject({ credentialsInSignedFile: 'none', fileCredentials: 'none', note: 'Credentials missing after a phone update.', classSetBy: 'creator' });
	});

	it('describes the signed file and how its signature read back', () => {
		expect(e.signedFile).toEqual({ fileName: 'film.signed.v2.mp4', sha256: 'ab'.repeat(32), bytes: 123456789, version: 2, signedAt: '2026-11-14T09:00:02.000Z' });
		expect(e.signature).toMatchObject({ status: 'unrecognised_issuer', hashVerified: true, issuerRecognised: false, signer: { commonName: 'Dev Signer', issuer: 'Dev CA' }, manifestCount: 2, failures: ['signingCredential.untrusted'] });
	});

	it('holds no paths, no database ids and no names of untracked clips', () => {
		const json = JSON.stringify(e);
		expect(json).not.toContain(dir);
		expect(json).not.toContain('private-name');
		// Numeric ids; vocabulary.positions[].id is a position name such as "captured".
		expect(json).not.toMatch(/"(id|assetId|projectId|matchedAssetId|signatureId)":\d/);
		expect(json).not.toContain('matchedAsset');
		expect(e.untracked).toEqual([{ track: 'V2', startSeconds: 1, endSeconds: 2, reason: 'no tracked asset' }]);
	});

	it('includes labels for the classes it uses, so a viewer needs no other vocabulary', () => {
		expect(Object.keys(e.vocabulary.classes).sort()).toEqual(['compositeSynthetic', 'computationalCapture', 'digitalCapture', 'trainedAlgorithmicMedia']);
		expect(e.vocabulary.positions.map(p => p.id)).toEqual(['captured', 'digital', 'assisted', 'hybrid', 'synthetic', 'unknown']);
	});

	it('refuses a copy signed before the statement carried the timeline', () => {
		const old = { ...signature, statementJson: JSON.stringify({ ...statement, version: 1, composition: { picture: {}, audio: {} } }) };
		expect(() => buildPublicExport({ signature: old, generatedAt: 'x', generator: GENERATOR })).toThrow(/Sign the output again/);
	});

	it('refuses an asset sidecar signature', () => {
		expect(() => buildPublicExport({ signature: { ...signature, kind: 'asset' }, generatedAt: 'x', generator: GENERATOR })).toThrow(/signed output/);
	});
});

describe('publicExportFileName', () => {
	it('names the export after the signed file', () => {
		expect(publicExportFileName(path.join(dir, 'film.signed.v2.mp4'))).toBe('film.signed.v2.provenance.json');
	});
});

describe('matchReadBack', () => {
	const ours = [{ ref: 'ing-1', title: 'a.mp4' }, { ref: 'ing-2', title: 'b.wav' }];
	const parent = { label: 'c2pa.ingredient.v3', title: 'film.mp4', relationship: 'parentOf' };
	it('uses our label when the reader kept it', () => {
		const rb = [parent, { label: 'ing-2', title: 'b.wav', relationship: 'componentOf' }, { label: 'ing-1', title: 'a.mp4', relationship: 'componentOf' }];
		expect(matchReadBack(ours, rb).map(m => m.label)).toEqual(['ing-1', 'ing-2']);
	});
	it('otherwise pairs by position among placed ingredients when the file name agrees', () => {
		const rb = [parent, { label: 'x__1', title: 'a.mp4', relationship: 'componentOf' }, { label: 'x__2', title: 'b.wav', relationship: 'componentOf' }];
		expect(matchReadBack(ours, rb).map(m => m.label)).toEqual(['x__1', 'x__2']);
	});
	it('falls back to a unique file name, and gives up rather than guess', () => {
		const rb = [parent, { label: 'x__1', title: 'b.wav', relationship: 'componentOf' }, { label: 'x__2', title: 'c.mov', relationship: 'componentOf' }];
		expect(matchReadBack(ours, rb).map(m => m?.label ?? null)).toEqual([null, 'x__1']);
	});
});
