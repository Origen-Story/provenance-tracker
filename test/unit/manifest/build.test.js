import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
	buildOutputManifest, buildCreatorStatement, buildAssetManifest, versionedSignedPath,
	placedAssetKeys, outputClassOf, STATEMENT_LABEL, PARENT_LABEL, sidecarPathFor, archivedSidecarPath, planSidecar,
	cleanPublicTitle, PUBLIC_TITLE_MAX
} from '../../../src/server/lib/manifest/build.js';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';
const GENERATOR = { name: 'provenance-tracker', version: '0.0.0-test' };
const dir = path.join(path.sep, 'media', 'project');

// A 10 s edit: a camera take on V1 for 0-6 s, a generated clip on V1 for
// 6-10 s, a title on V2 over 0-2 s, and a voice on A1 throughout.
const assets = new Map([
	['produced:11', { filePath: path.join(dir, 'take-01.mp4'), originClass: 'computationalCapture', originClassConfirmed: true, originClassNote: 'The phone stopped signing after a system update.', publicTitle: '  Street interview,\n phone camera ', c2paSummary: null }],
	['ai:21', { filePath: path.join(dir, 'gen-01.mp4'), originClass: 'trainedAlgorithmicMedia', originClassConfirmed: false, signedBy: 'tool', signerName: 'Gen Tool', c2paSummary: {
		claimGenerator: 'Gen Tool', ingredients: [], signatureInfo: { issuer: 'Gen Inc', commonName: 'Gen Tool' },
		assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: `${IPTC}trainedAlgorithmicMedia` }] } }]
	} }],
	['produced:12', { filePath: path.join(dir, 'voice.wav'), originClass: 'digitalCapture', originClassConfirmed: true, c2paSummary: null }]
]);

const seg = (o) => ({ enabled: true, trackKind: 'video', trackIndex: 1, sourceKind: 'file', ...o });
const segments = [
	seg({ startFrame: 0, endFrame: 180, matchedAssetType: 'produced', matchedAssetId: 11, clipName: 'take-01' }),
	seg({ startFrame: 180, endFrame: 300, matchedAssetType: 'ai', matchedAssetId: 21, clipName: 'gen-01' }),
	seg({ trackIndex: 2, startFrame: 0, endFrame: 60, sourceKind: 'generator', clipName: 'Title' }),
	seg({ trackKind: 'audio', startFrame: 0, endFrame: 300, matchedAssetType: 'produced', matchedAssetId: 12, clipName: 'voice' }),
	seg({ trackIndex: 3, startFrame: 30, endFrame: 60, clipName: 'missing.mov', startSeconds: 1, endSeconds: 2 }),
	seg({ startFrame: 0, endFrame: 300, enabled: false, matchedAssetType: 'produced', matchedAssetId: 99, clipName: 'disabled' })
];
const L = (type, id) => ({ matchedAssetType: type, matchedAssetId: id });
const composition = {
	durationSeconds: 10, fps: 30,
	picture: {
		intervals: [
			{ startSeconds: 0, endSeconds: 2, positions: ['captured', 'digital'], layers: [{}, L('produced', 11)] },
			{ startSeconds: 2, endSeconds: 6, positions: ['captured'], layers: [L('produced', 11)] },
			{ startSeconds: 6, endSeconds: 10, positions: ['synthetic'], layers: [L('ai', 21)] }
		],
		byPosition: { captured: { seconds: 4, percent: 40 }, synthetic: { seconds: 4, percent: 40 } },
		mixed: { seconds: 2, percent: 20, combos: { 'captured+digital': { seconds: 2, percent: 20 } } },
		gap: { seconds: 0, percent: 0 }
	},
	audio: {
		intervals: [{ startSeconds: 0, endSeconds: 10, positions: ['captured'], layers: [L('produced', 12)] }],
		byPosition: { captured: { seconds: 10, percent: 100 } }, mixed: { seconds: 0, percent: 0, combos: {} }, gap: { seconds: 0, percent: 0 }
	}
};
const output = { type: 'produced', id: 1, filePath: path.join(dir, 'final.mp4'), publicTitle: 'A Short Film', originClass: 'compositeSynthetic', originClassConfirmed: false };
const timeline = { sequenceName: 'Final', fps: 30 };
const statement = { text: '  A short film about provenance.  ', authorName: 'A. Creator', organization: 'Example Studio', softwareAgent: 'Premiere Pro', identityUrl: 'https://example.org/id' };

describe('placedAssetKeys', () => {
	it('lists enabled matched assets in order of first use, once each, without the output', () => {
		expect(placedAssetKeys([...segments, seg({ startFrame: 0, endFrame: 1, matchedAssetType: 'produced', matchedAssetId: 1 })], 'produced:1'))
			.toEqual(['produced:11', 'produced:12', 'ai:21']);
	});
});

describe('buildCreatorStatement', () => {
	const s = buildCreatorStatement({ output, timeline, composition, segments, assets, statement, statedAt: '2026-11-13T10:00:00Z' });

	it('carries the creator\'s words and who says them', () => {
		expect(s).toMatchObject({ version: 2, statedAt: '2026-11-13T10:00:00Z', text: 'A short film about provenance.', author: 'A. Creator', organization: 'Example Studio', editedWith: 'Premiere Pro' });
	});

	it('names the output by file name only, never a path', () => {
		expect(s.output).toMatchObject({ title: 'final.mp4', publicTitle: 'A Short Film', originClass: 'compositeSynthetic', digitalSourceType: `${IPTC}compositeSynthetic`, durationSeconds: 10, fps: 30 });
		expect(JSON.stringify(s)).not.toContain(dir);
	});

	it('copies the composition numbers per lane', () => {
		expect(s.composition.picture.byPosition.captured).toEqual({ seconds: 4, percent: 40 });
		expect(s.composition.picture.mixed.combos['captured+digital']).toEqual({ seconds: 2, percent: 20 });
		expect(s.composition.audio.byPosition.captured.percent).toBe(100);
	});

	it('records, per ingredient, the class, who set it, what the file itself claims, and the note', () => {
		const [take, voice, gen] = s.ingredients;
		expect(take).toMatchObject({
			ref: 'ing-1', title: 'take-01.mp4', publicTitle: 'Street interview, phone camera', originClass: 'computationalCapture', position: 'captured', classSetBy: 'creator',
			fileCredentials: 'none', classClaimedByFile: null, signedBy: '', note: 'The phone stopped signing after a system update.',
			pictureSeconds: 6, audioSeconds: 0
		});
		expect(voice).toMatchObject({ title: 'voice.wav', publicTitle: '', audioSeconds: 10, pictureSeconds: 0 });
		expect(gen).toMatchObject({ title: 'gen-01.mp4', classSetBy: 'proposal', fileCredentials: 'present', classClaimedByFile: 'trainedAlgorithmicMedia', signedBy: 'tool', signerName: 'Gen Tool', position: 'synthetic', pictureSeconds: 4 });
	});

	it('keeps the C2PA ingredient title as the file name, whatever the public title', () => {
		const { ingredients } = buildOutputManifest({ output, timeline, composition, segments, assets, statement, statedAt: 'x', generator: GENERATOR });
		expect(ingredients.find(i => i.label === 'ing-1').title).toBe('take-01.mp4');
		expect(ingredients[0].title).toBe('final.mp4');
	});

	it('lists clips it could not tie to an asset, and counts editor-made titles', () => {
		expect(s.unresolved).toEqual([{ clip: 'missing.mov', track: 'V3', startSeconds: 1, endSeconds: 2, reason: 'no tracked asset' }]);
		expect(s.editorGeneratedClips).toBe(1);
	});
});

describe('outputClassOf', () => {
	it('uses a class the creator confirmed', () => {
		expect(outputClassOf({ originClass: 'compositeCapture', originClassConfirmed: true }, composition)).toBe('compositeCapture');
	});
	it('otherwise follows the composition', () => {
		expect(outputClassOf({ originClass: 'unknown', originClassConfirmed: false }, composition)).toBe('compositeSynthetic');
	});
});

describe('buildOutputManifest', () => {
	const m = buildOutputManifest({ output, timeline, composition, segments, assets, statement, statedAt: 't', generator: GENERATOR });
	const actions = m.definition.assertions.find(a => a.label === 'c2pa.actions.v2').data.actions;

	it('opens the export as the parent and places each asset with its source type', () => {
		expect(m.ingredients[0]).toEqual({ label: PARENT_LABEL, relationship: 'parentOf', title: 'final.mp4', useInput: true });
		expect(m.ingredients.slice(1).map(i => [i.label, i.relationship, i.title])).toEqual([['ing-1', 'componentOf', 'take-01.mp4'], ['ing-2', 'componentOf', 'voice.wav'], ['ing-3', 'componentOf', 'gen-01.mp4']]);
		expect(actions[0]).toMatchObject({ action: 'c2pa.opened', digitalSourceType: `${IPTC}compositeSynthetic`, softwareAgent: { name: 'Premiere Pro' }, parameters: { ingredientIds: [PARENT_LABEL] } });
		expect(actions.slice(1).map(a => [a.action, a.digitalSourceType, a.parameters.ingredientIds[0]])).toEqual([
			['c2pa.placed', `${IPTC}computationalCapture`, 'ing-1'],
			['c2pa.placed', `${IPTC}digitalCapture`, 'ing-2'],
			['c2pa.placed', `${IPTC}trainedAlgorithmicMedia`, 'ing-3']
		]);
	});

	it('includes the statement, the author with the identity URL, and the training opt-out, and no unsigned CAWG assertion', () => {
		const labels = m.definition.assertions.map(a => a.label);
		expect(labels).toEqual(['c2pa.actions.v2', STATEMENT_LABEL, 'stds.schema-org.CreativeWork', 'c2pa.training-mining']);
		expect(m.definition.assertions[1].data).toBe(m.statement);
		expect(m.definition.assertions[2].data.author[0]).toEqual({ '@type': 'Person', name: 'A. Creator', url: 'https://example.org/id' });
		expect(m.definition.claim_generator_info).toEqual([GENERATOR]);
	});

	it('leaves the source type off an asset whose class is unknown', () => {
		const a = new Map(assets);
		a.set('produced:11', { ...a.get('produced:11'), originClass: 'unknown' });
		const placed = buildOutputManifest({ output, timeline, composition, segments, assets: a, statement, statedAt: 't', generator: GENERATOR })
			.definition.assertions[0].data.actions[1];
		expect(placed.digitalSourceType).toBeUndefined();
	});

	it('refuses without a file or a timeline', () => {
		expect(() => buildOutputManifest({ output: { id: 1 }, composition, segments, assets, generator: GENERATOR })).toThrow(/no file/);
		expect(() => buildOutputManifest({ output, composition: null, segments, assets, generator: GENERATOR })).toThrow(/timeline/);
	});
});

describe('buildAssetManifest', () => {
	it('declares how a file without credentials was made', () => {
		const { definition, ingredients } = buildAssetManifest({ title: 'voice.wav', originClass: 'digitalCapture', toolUsed: 'Recorder', authorName: 'A', generator: GENERATOR });
		expect(ingredients).toEqual([]);
		expect(definition.assertions[0].data.actions).toEqual([{ action: 'c2pa.created', digitalSourceType: `${IPTC}digitalCapture`, softwareAgent: { name: 'Recorder' } }]);
	});
	it('lets the signer mark a file AI-generated whatever its class', () => {
		const { definition } = buildAssetManifest({ title: 'x.wav', originClass: 'digitalCapture', isAiGenerated: true, generator: GENERATOR });
		expect(definition.assertions[0].data.actions[0].digitalSourceType).toBe(`${IPTC}trainedAlgorithmicMedia`);
	});
	it('keeps existing credentials as the parent', () => {
		const { definition, ingredients } = buildAssetManifest({ title: 'clip.mp4', originClass: 'computationalCapture', hasManifest: true, generator: GENERATOR });
		expect(ingredients).toEqual([{ label: PARENT_LABEL, relationship: 'parentOf', title: 'clip.mp4', useInput: true }]);
		expect(definition.assertions[0].data.actions[0]).toMatchObject({ action: 'c2pa.opened', parameters: { ingredientIds: [PARENT_LABEL] } });
	});
	it('refuses to invent a source type for an unknown class', () => {
		expect(() => buildAssetManifest({ title: 'x', originClass: 'unknown', generator: GENERATOR })).toThrow(/origin class/);
	});
	it('omits the training opt-out when asked', () => {
		const { definition } = buildAssetManifest({ title: 'x', originClass: 'digitalCapture', trainingMiningOptOut: false, generator: GENERATOR });
		expect(definition.assertions.map(a => a.label)).not.toContain('c2pa.training-mining');
	});
});

describe('versionedSignedPath', () => {
	const input = path.join(dir, 'final.mp4');
	it('takes the first free version beside the input', () => {
		const taken = new Set([path.join(dir, 'final.signed.v1.mp4')]);
		expect(versionedSignedPath(input, p => taken.has(p))).toEqual({ path: path.join(dir, 'final.signed.v2.mp4'), version: 2 });
	});
	it('does not stack suffixes when given a signed copy', () => {
		expect(versionedSignedPath(path.join(dir, 'final.signed.v3.mp4'), () => false).path).toBe(path.join(dir, 'final.signed.v1.mp4'));
	});
});

describe('sidecar naming and re-signing (D13)', () => {
	const input = path.join(dir, 'take-01.mp4');
	const sidecar = path.join(dir, 'take-01.c2pa');

	it('names the sidecar like the file, where C2PA readers look', () => {
		expect(sidecarPathFor(input)).toBe(sidecar);
		expect(archivedSidecarPath(input, 2)).toBe(path.join(dir, 'take-01.v2.c2pa'));
	});

	it('writes version 1 when there is no sidecar yet', () => {
		expect(planSidecar({ inputPath: input, sidecarExists: false, currentSignature: null, latestVersion: 0 }))
			.toEqual({ action: 'write', version: 1, sidecarPath: sidecar });
	});

	it('archives its own earlier sidecar under that signature\'s version before writing the next', () => {
		expect(planSidecar({ inputPath: input, sidecarExists: true, currentSignature: { id: 7, version: 2 }, latestVersion: 2 })).toEqual({
			action: 'rotate', version: 3, sidecarPath: sidecar,
			archive: { signatureId: 7, from: sidecar, to: path.join(dir, 'take-01.v2.c2pa') }
		});
	});

	it('refuses to replace a .c2pa it did not write', () => {
		const p = planSidecar({ inputPath: input, sidecarExists: true, currentSignature: null, latestVersion: 0 });
		expect(p.action).toBe('refuse');
		expect(p.reason).toMatch(/take-01\.c2pa.*did not write/);
	});
});

describe('cleanPublicTitle', () => {
	it('makes one trimmed line of plain text', () => {
		expect(cleanPublicTitle('  Street\r\n  interview\t(take 2) ')).toBe('Street interview (take 2)');
		expect(cleanPublicTitle('a\u0000b')).toBe('a b');
	});
	it('treats missing values as empty', () => {
		expect(cleanPublicTitle(undefined)).toBe('');
		expect(cleanPublicTitle(null)).toBe('');
		expect(cleanPublicTitle('   ')).toBe('');
	});
	it('caps the length without leaving a trailing space', () => {
		const long = 'word '.repeat(60);
		const out = cleanPublicTitle(long);
		expect(out.length).toBeLessThanOrEqual(PUBLIC_TITLE_MAX);
		expect(out).toBe(out.trim());
	});
});
