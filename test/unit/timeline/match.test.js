import { describe, it, expect } from 'vitest';
import { buildMatchIndex, matchClips, normalizePath, sourcesFromTimeline, matchesByClip, reconcileManualMatch } from '../../../src/server/lib/timeline/match.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../src/server/lib/timeline/formats/xmeml.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(path.resolve(here, '../../fixtures/timeline/sample.xmeml.xml'), 'utf8');

const assets = [
	{ type: 'produced', id: 1, filename: 'Clip 01.mp4', filePath: 'P:\\Demo Project\\assets\\Clip 01.mp4', fileHash: 'h1', fileSize: 1000, originClass: 'captured_signed' },
	{ type: 'ai', id: 2, filename: 'Still 02.png', filePath: 'P:/store/ai-assets/Still 02.png', originalFilePath: 'P:/Demo Project/assets/Still 02.png', fileHash: 'h2', fileSize: 2000, originClass: 'generated' },
	{ type: 'archival', id: 3, filename: 'Old 04.mp4', filePath: 'P:/store/archival/Old 04.mp4', fileHash: 'h4', fileSize: 4000, originClass: 'archival' },
	{ type: 'ai', id: 5, filename: 'Overlay 05.mp4', filePath: 'P:/elsewhere/Overlay 05.mp4', fileHash: 'h5', fileSize: 5000, originClass: 'generated' },
	{ type: 'ai', id: 6, filename: 'Overlay 05.mp4', filePath: 'P:/other/Overlay 05.mp4', fileHash: 'h6', fileSize: 6000, originClass: 'generated' }
];

describe('normalizePath', () => {
	it('folds slashes and case', () => {
		expect(normalizePath('P:\\Demo Project\\assets\\Clip 01.mp4')).toBe('p:/demo project/assets/clip 01.mp4');
		expect(normalizePath('/Volumes/Media/')).toBe('/volumes/media');
	});
});

describe('matchClips', () => {
	const index = buildMatchIndex(assets);
	const io = {
		statSize: async (p) => ({ 'P:/Demo Project/assets/Overlay 05.mp4': 6000 })[p] ?? null,
		hashFile: async (p) => ({ 'P:/Demo Project/assets/Renamed 04.mp4': 'h4' })[p] ?? null
	};

	it('matches by path, including the preserved original path of a signed copy', async () => {
		const m = await matchClips([{ key: 'a', path: 'P:/Demo Project/assets/Clip 01.mp4' }, { key: 'b', path: 'P:/Demo Project/assets/Still 02.png' }], index, io);
		expect(m.get('a')).toMatchObject({ method: 'path', confidence: 1, asset: { id: 1 } });
		expect(m.get('b')).toMatchObject({ method: 'path', confidence: 1, asset: { id: 2, type: 'ai' } });
	});

	it('matches a renamed source by hash', async () => {
		const m = await matchClips([{ key: 'r', path: 'P:/Demo Project/assets/Renamed 04.mp4' }], index, io);
		expect(m.get('r')).toMatchObject({ method: 'hash', confidence: 1, asset: { id: 3 } });
	});

	it('falls back to filename plus size, then to filename only', async () => {
		const m = await matchClips([{ key: 'o', path: 'P:/Demo Project/assets/Overlay 05.mp4' }], index, io);
		expect(m.get('o')).toMatchObject({ method: 'filename_size', confidence: 0.9, asset: { id: 6 } });
		expect(m.get('o').candidates.length).toBe(2);
		const weak = await matchClips([{ key: 'o', path: 'P:/Demo Project/assets/Overlay 05.mp4' }], index, {});
		expect(weak.get('o')).toMatchObject({ method: 'filename', confidence: 0.4, asset: { id: 5 } });
	});

	it('reports unmatched', async () => {
		const m = await matchClips([{ key: 'x', path: 'P:/Demo Project/assets/Clip 03 disabled.mov' }], index, io);
		expect(m.get('x')).toEqual({ asset: null, method: 'unmatched', confidence: 0, candidates: [] });
	});

	it('works end to end from a parsed timeline', async () => {
		const t = parse(SAMPLE);
		const sources = sourcesFromTimeline(t);
		expect(sources.map(s => s.key)).toEqual(['file-1', 'file-2', 'file-3', 'file-4', 'file-5']);
		const bySource = await matchClips(sources, index, io);
		const byClip = matchesByClip(t, bySource);
		expect(byClip.get('clipitem-21').asset.id).toBe(1);
		expect(byClip.get('clipitem-31').asset.id).toBe(1); // audio half shares the match
		expect(byClip.get('clipitem-25').method).toBe('hash');
		expect(byClip.get('clipitem-23').method).toBe('unmatched');
		expect(byClip.has('clipitem-24')).toBe(false);      // nested sequence has no source file
		expect(byClip.has('clipitem-26')).toBe(false);      // generator
	});
});

describe('reconcileManualMatch', () => {
	const asset = { type: 'ai', id: 7, filePath: 'P:/store/ai/clip.mp4', originalFilePath: 'P:/Demo Project/assets/Clip.mp4', fileHash: 'abc' };
	it('keeps the stronger evidence when the pick agrees with the file', () => {
		expect(reconcileManualMatch({ path: 'p:\\demo project\\assets\\CLIP.mp4', hash: null }, asset)).toEqual({ method: 'path', confidence: 1 });
		expect(reconcileManualMatch({ path: 'P:/elsewhere/renamed.mp4', hash: 'abc' }, asset)).toEqual({ method: 'hash', confidence: 1 });
	});
	it('records a plain manual pick when nothing agrees', () => {
		expect(reconcileManualMatch({ path: 'P:/elsewhere/other.mp4', hash: 'zzz' }, asset)).toEqual({ method: 'manual', confidence: 1 });
		expect(reconcileManualMatch({ path: null, hash: null }, asset)).toEqual({ method: 'manual', confidence: 1 });
		expect(reconcileManualMatch({ path: 'x', hash: 'abc' }, null)).toEqual({ method: 'unmatched', confidence: 0 });
	});
});
