import { describe, it, expect } from 'vitest';
import { topazSourceBasename, findSourceCandidates, stripExtension } from '../../../src/server/lib/relationships/auto-link.js';

describe('topazSourceBasename', () => {
	it('strips Topaz Video AI model suffixes', () => {
		expect(topazSourceBasename('clip_prob4.mov')).toBe('clip');
		expect(topazSourceBasename('Scene 12 wide_iris2.mp4')).toBe('Scene 12 wide');
		expect(topazSourceBasename('photo_1920s_street_thm2_2x.mov')).toBe('photo_1920s_street');
	});
	it('strips the Gigapixel tail', () => {
		expect(topazSourceBasename('freepik__wide-shot__86475-gigapixel-redefine-realistic-2x-faceai v2.png')).toBe('freepik__wide-shot__86475');
	});
	it('returns null for ordinary names', () => {
		expect(topazSourceBasename('PXL_20261102_180109038.mp4')).toBeNull();
		expect(topazSourceBasename('interview_take3.wav')).toBeNull();
		expect(topazSourceBasename('')).toBeNull();
	});
});

describe('findSourceCandidates', () => {
	const index = [
		{ type: 'archival', id: 1, filename: 'photo_1920s_street.jpg' },
		{ type: 'ai', id: 7, filename: 'photo_1920s_street_thm2_2x.mov' },
		{ type: 'produced', id: 3, filename: 'Clip.MP4' },
		{ type: 'ai', id: 9, filename: 'clip_prob4.mov' }
	];
	it('matches on the stem, case-insensitively, across extensions', () => {
		expect(findSourceCandidates('photo_1920s_street', index)).toEqual([index[0]]);
		expect(findSourceCandidates('clip', index, { type: 'ai', id: 9 })).toEqual([index[2]]);
	});
	it('excludes the asset itself and returns empty for no match', () => {
		expect(findSourceCandidates('clip', [index[3]], { type: 'ai', id: 9 })).toEqual([]);
		expect(findSourceCandidates(null, index)).toEqual([]);
	});
	it('stripExtension leaves dotted stems alone', () => {
		expect(stripExtension('Catalan_Echoes_2026-04-30T142200.wav')).toBe('Catalan_Echoes_2026-04-30T142200');
		expect(stripExtension('archive.tar.gz')).toBe('archive.tar');
	});
});
