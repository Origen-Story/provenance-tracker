// Writes example.provenance.json: a made-up 96-second film, run through the
// real statement and export builders so the demo always matches the format.
//   node public-viewer/example/make-example.mjs
// Every name, signer and hash here is invented.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildCreatorStatement } from '../../src/server/lib/manifest/build.js';
import { buildPublicExport } from '../../src/server/lib/manifest/public-export.js';
import { sourceTypeUri } from '../../src/shared/origin-vocabulary.js';

const FPS = 30;
const DURATION = 96;
const credentials = (generator, originClass) => ({
	claimGenerator: generator, ingredients: [],
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: sourceTypeUri(originClass) }] } }]
});

// key -> asset, as the tracker would hold it
const A = {
	opening: { filePath: 'gen_harbour_wide_v3.mp4', publicTitle: 'Opening view of the harbour', originClass: 'trainedAlgorithmicMedia', signedBy: 'tool', signerName: 'Example Video Model', c2paSummary: credentials('Example Video Model', 'trainedAlgorithmicMedia') },
	music: { filePath: 'score_morning_theme.wav', publicTitle: 'Music: morning theme', originClass: 'trainedAlgorithmicMedia', signedBy: 'tool', signerName: 'Example Music Model', c2paSummary: credentials('Example Music Model', 'trainedAlgorithmicMedia') },
	interview: { filePath: 'PXL_20261104_101530.mp4', publicTitle: 'Interview with a stallholder', originClass: 'computationalCapture', originClassConfirmed: true, signedBy: 'device', signerName: 'Example Phone', c2paSummary: credentials('Example Phone', 'computationalCapture') },
	photo: { filePath: 'scan_0042.tif', publicTitle: 'Market photograph, 1962', originClass: 'print', originClassConfirmed: true, originClassNote: 'Scanned by the creator from a family print; no credentials at the time.', c2paSummary: null },
	restored: { filePath: 'archive_reel_07_upscaled.mov', publicTitle: 'Archive film, restored', originClass: 'algorithmicallyEnhanced', signedBy: 'tool', signerName: 'Example Upscaler', c2paSummary: credentials('Example Upscaler', 'algorithmicallyEnhanced') },
	extended: { filePath: 'stall_wide_genfill.mp4', publicTitle: 'Stall, background extended with AI', originClass: 'compositeWithTrainedAlgorithmicMedia', originClassConfirmed: true, originClassNote: 'Camera footage; the sky and the far side of the square were generated to widen the frame.', c2paSummary: null },
	screen: { filePath: 'screen-01-tracker.mp4', publicTitle: 'Screen recording of the provenance tracker', originClass: 'screenCapture', originClassConfirmed: true, originClassNote: 'Recorded on the creator’s computer.', c2paSummary: null },
	closing: { filePath: 'PXL_20261104_114210.mp4', publicTitle: 'Closing shot, the square at noon', originClass: 'computationalCapture', signedBy: 'device', signerName: 'Example Phone', c2paSummary: credentials('Example Phone', 'computationalCapture') },
	voice: { filePath: 'vo_take3.wav', publicTitle: 'Narration', originClass: 'digitalCapture', originClassConfirmed: true, signedBy: 'creator', signerName: 'Example Studio', c2paSummary: credentials('provenance-tracker', 'digitalCapture') },
	door: { filePath: 'sfx_door_02.wav', publicTitle: 'Sound effect: shop door', originClass: 'unknown', c2paSummary: null }
};
const ids = Object.fromEntries(Object.keys(A).map((k, i) => [k, i + 1]));
const assets = new Map(Object.entries(A).map(([k, a]) => [`produced:${ids[k]}`, a]));
const POS = { trainedAlgorithmicMedia: 'synthetic', computationalCapture: 'captured', print: 'captured', algorithmicallyEnhanced: 'assisted', compositeWithTrainedAlgorithmicMedia: 'hybrid', screenCapture: 'digital', digitalCapture: 'captured', unknown: 'unknown' };
const TITLE = { title: true };

// [start, end, layers top track first]; a layer is an asset key or TITLE (made in the editor)
const PICTURE = [
	[0, 6, [TITLE, 'opening']], [6, 18, ['opening']], [18, 40, ['interview']], [40, 48, ['photo']],
	[48, 56, ['restored']], [56, 70, ['interview']], [70, 78, ['extended']], [78, 88, ['screen']],
	[88, 92, ['closing']], [92, 96, [TITLE, 'closing']]
];
const AUDIO = [
	[0, 18, ['music']], [18, 40, ['interview', 'music']], [40, 56, ['voice']], [56, 70, ['interview']],
	[70, 84, ['voice', 'music']], [84, 86, ['voice', 'door', 'music']], [86, 96, ['voice', 'music']]
];

function lane(rows) {
	const intervals = rows.map(([start, end, layers]) => {
		const positions = [...new Set(layers.map(l => (l === TITLE ? 'digital' : POS[A[l].originClass])))];
		return {
			startSeconds: start, endSeconds: end, positions,
			layers: layers.map(l => (l === TITLE ? {} : { matchedAssetType: 'produced', matchedAssetId: ids[l] }))
		};
	});
	const stat = (s) => ({ seconds: s, percent: (s / DURATION) * 100 });
	const byPosition = {};
	const combos = {};
	let mixed = 0;
	for (const iv of intervals) {
		const len = iv.endSeconds - iv.startSeconds;
		if (iv.positions.length === 1) byPosition[iv.positions[0]] = (byPosition[iv.positions[0]] || 0) + len;
		else { mixed += len; const k = [...iv.positions].sort().join('+'); combos[k] = (combos[k] || 0) + len; }
	}
	return {
		intervals,
		byPosition: Object.fromEntries(Object.entries(byPosition).map(([p, s]) => [p, stat(s)])),
		mixed: { ...stat(mixed), combos: Object.fromEntries(Object.entries(combos).map(([k, s]) => [k, stat(s)])) },
		gap: stat(0)
	};
}

const segments = [];
for (const [kind, rows] of [['video', PICTURE], ['audio', AUDIO]]) {
	for (const [start, end, layers] of rows) {
		layers.forEach((l, n) => segments.push(l === TITLE
			? { enabled: true, trackKind: kind, trackIndex: 2, sourceKind: 'generator', startFrame: start * FPS, endFrame: end * FPS }
			: { enabled: true, trackKind: kind, trackIndex: layers.length - n, sourceKind: 'file', startFrame: start * FPS, endFrame: end * FPS, matchedAssetType: 'produced', matchedAssetId: ids[l] }));
	}
}

const statement = buildCreatorStatement({
	output: { type: 'produced', id: 99, filePath: 'morning-market.mp4', publicTitle: 'A Morning at the Market', originClass: 'compositeSynthetic', originClassConfirmed: true },
	timeline: { sequenceName: 'Morning market v12', fps: FPS },
	composition: { durationSeconds: DURATION, fps: FPS, picture: lane(PICTURE), audio: lane(AUDIO) },
	segments, assets,
	statement: {
		text: 'A short portrait of a neighbourhood market, made to show how a film can say where every part of it came from.\n\nThe interview and the closing shot were filmed on a phone that signs what it records. The opening view of the harbour and the music were generated with AI, and one shot of the square was widened with AI. The archive photograph has no credentials of its own, so I have said where it came from.',
		authorName: 'A. Example', organization: 'Example Studio', softwareAgent: 'Premiere Pro'
	},
	statedAt: '2026-11-14T09:30:00Z'
});

// A read-back as c2patool reports it: ingredients renamed by assertion, in order, parent first.
const placed = statement.ingredients;
const report = {
	active_manifest: 'urn:c2pa:example-film',
	manifests: {
		'urn:c2pa:example-film': {
			ingredients: [
				{ label: 'c2pa.ingredient.v3', title: 'morning-market.mp4', relationship: 'parentOf' },
				...placed.map((i, n) => ({ label: `c2pa.ingredient.v3__${n + 1}`, title: i.title, relationship: 'componentOf', ...(i.fileCredentials === 'present' ? { active_manifest: `urn:c2pa:${i.ref}` } : {}) }))
			],
			signature_info: { issuer: 'Example Trust Services CA', common_name: 'Example Studio', alg: 'Es256', time: '2026-11-14T09:30:04Z' }
		},
		...Object.fromEntries(placed.filter(i => i.fileCredentials === 'present').map(i => [`urn:c2pa:${i.ref}`, {}]))
	},
	validation_results: { activeManifest: { success: [{ code: 'claimSignature.validated' }, { code: 'assertion.bmffHash.match' }], failure: [] } }
};

const exported = buildPublicExport({
	signature: {
		kind: 'output', version: 1, signedPath: 'morning-market.signed.v1.mp4',
		signedHash: createHash('sha256').update('provenance-tracker example film').digest('hex'),
		signedSize: 412345678, statement, report, createdAt: '2026-11-14T09:30:05Z'
	},
	generatedAt: '2026-11-14T09:31:00Z',
	generator: { name: 'provenance-tracker', version: 'example' }
});

const out = path.join(import.meta.dirname, 'example.provenance.json');
writeFileSync(out, JSON.stringify(exported, null, 2) + '\n');
console.log('wrote', out);
