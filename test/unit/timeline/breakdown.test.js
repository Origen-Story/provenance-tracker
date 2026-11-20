import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBreakdown, segmentsFromTimeline } from '../../../src/server/lib/timeline/breakdown.js';
import { parse } from '../../../src/server/lib/timeline/formats/xmeml.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(path.resolve(here, '../../fixtures/timeline/sample.xmeml.xml'), 'utf8');
const FPS = 30000 / 1001;

function seg(over) {
	return { trackKind: 'video', trackIndex: 1, enabled: true, startFrame: 0, endFrame: 0, inFrame: 0, outFrame: 0, sourceKind: 'file', sourceKey: null, matched: true, originClass: null, ...over };
}

const sumPercent = (bd) => Object.values(bd.byClass).reduce((s, v) => s + v.percent, 0) + bd.gap.percent;

describe('computeBreakdown primary track', () => {
	const segments = [
		seg({ startFrame: 0, endFrame: 100, originClass: 'captured_signed', sourceKey: 'a' }),
		seg({ startFrame: 100, endFrame: 200, originClass: 'generated', sourceKey: 'b' }),
		seg({ startFrame: 200, endFrame: 260, originClass: 'generated', sourceKey: 'c', enabled: false }),
		seg({ startFrame: 260, endFrame: 300, sourceKind: 'sequence', matched: false }),
		seg({ startFrame: 300, endFrame: 400, originClass: 'archival_enhanced', sourceKey: 'd' })
	];
	const bd = computeBreakdown(segments, { durationFrames: 400, fps: FPS });

	it('sums classes and gap to 100 percent of the sequence', () => {
		expect(sumPercent(bd.primary)).toBeCloseTo(100, 6);
	});
	it('counts frames per class, excludes disabled clips, reports gaps and unknowns', () => {
		expect(bd.primary.byClass.captured_signed.frames).toBe(100);
		expect(bd.primary.byClass.generated.frames).toBe(100); // the disabled clip is not counted
		expect(bd.primary.byClass.unknown.frames).toBe(40);    // nested sequence
		expect(bd.primary.byClass.archival_enhanced.percent).toBeCloseTo(25, 6);
		expect(bd.primary.gap.frames).toBe(60);
		expect(bd.primary.gap.percent).toBeCloseTo(15, 6);
		expect(bd.durationSeconds).toBeCloseTo(400 / FPS, 6);
		expect(bd.counts).toMatchObject({ segments: 5, nested: 1, disabled: 1 });
	});
	it('changes when a class is overridden', () => {
		const changed = computeBreakdown(segments.map(s => (s.sourceKey === 'b' ? { ...s, originClass: 'archival' } : s)), { durationFrames: 400, fps: FPS });
		expect(changed.primary.byClass.generated).toBeUndefined();
		expect(changed.primary.byClass.archival.frames).toBe(100);
	});
	it('unmatched file clips count as unknown', () => {
		const u = computeBreakdown([seg({ startFrame: 0, endFrame: 50, matched: false })], { durationFrames: 50, fps: FPS });
		expect(u.primary.byClass.unknown.frames).toBe(50);
		expect(u.counts.unmatched).toBe(1);
	});
	it('clips segments to the sequence duration', () => {
		const o = computeBreakdown([seg({ startFrame: 350, endFrame: 420, originClass: 'captured' })], { durationFrames: 400, fps: FPS });
		expect(o.primary.byClass.captured.frames).toBe(50);
	});
});

describe('computeBreakdown overlays', () => {
	const segments = [
		seg({ startFrame: 0, endFrame: 400, originClass: 'captured', sourceKey: 'base' }),
		seg({ trackIndex: 2, startFrame: 50, endFrame: 80, sourceKind: 'generator', matched: false }),
		seg({ trackIndex: 2, startFrame: 350, endFrame: 420, originClass: 'generated', sourceKey: 'ov' })
	];
	it('leaves primary alone and lets the top track win in overlay mode', () => {
		const off = computeBreakdown(segments, { durationFrames: 400, fps: FPS });
		expect(off.overlays).toBeNull();
		expect(off.primary.byClass.captured.frames).toBe(400);
		const on = computeBreakdown(segments, { durationFrames: 400, fps: FPS, includeOverlays: true });
		expect(on.primary.byClass.captured.frames).toBe(400);
		expect(on.overlays.byClass.captured.frames).toBe(320);
		expect(on.overlays.byClass.digitalCreation.frames).toBe(30); // a generator is a human-made graphic
		expect(on.overlays.byClass.generated.frames).toBe(50);
		expect(sumPercent(on.overlays)).toBeCloseTo(100, 6);
	});
});

describe('computeBreakdown audio', () => {
	it('collapses stereo-exploded pairs and reports per track', () => {
		const segments = [
			seg({ trackKind: 'audio', trackIndex: 1, startFrame: 0, endFrame: 100, inFrame: 10, originClass: 'captured_signed', sourceKey: 'f1' }),
			seg({ trackKind: 'audio', trackIndex: 2, startFrame: 0, endFrame: 100, inFrame: 10, originClass: 'captured_signed', sourceKey: 'f1' }),
			seg({ trackKind: 'audio', trackIndex: 3, startFrame: 0, endFrame: 400, originClass: 'generated', sourceKey: 'bed' })
		];
		const bd = computeBreakdown(segments, { durationFrames: 400, fps: FPS });
		expect(bd.audio.byClass.captured_signed.frames).toBe(100);
		expect(bd.audio.byClass.generated.percentOfTimeline).toBeCloseTo(100, 6);
		expect(bd.audio.totalFrames).toBe(500);
		expect(bd.audio.tracks.map(t => t.index)).toEqual([1, 2, 3]);
		expect(bd.audio.tracks[1].frames).toBe(100);
	});
});

describe('segmentsFromTimeline', () => {
	it('flattens the parsed sample with match results', () => {
		const t = parse(SAMPLE);
		const matches = new Map([
			['clipitem-21', { asset: { type: 'produced', id: 1, originClass: 'captured_signed' }, method: 'path', confidence: 1 }],
			['clipitem-31', { asset: { type: 'produced', id: 1, originClass: 'captured_signed' }, method: 'path', confidence: 1 }],
			['clipitem-32', { asset: { type: 'produced', id: 1, originClass: 'captured_signed' }, method: 'path', confidence: 1 }],
			['clipitem-22', { asset: { type: 'ai', id: 2, originClass: 'generated' }, method: 'hash', confidence: 1 }]
		]);
		const segments = segmentsFromTimeline(t, matches);
		expect(segments.length).toBe(9);
		const first = segments.find(s => s.clipId === 'clipitem-21');
		expect(first).toMatchObject({ trackKind: 'video', trackIndex: 1, matched: true, matchMethod: 'path', matchedAssetType: 'produced', matchedAssetId: 1, originClass: 'captured_signed', sourceKey: 'file-1' });
		expect(segments.find(s => s.clipId === 'clipitem-23').enabled).toBe(false);
		expect(segments.find(s => s.clipId === 'clipitem-25')).toMatchObject({ matched: false, matchMethod: 'unmatched', originClass: null });
		expect(segments.find(s => s.clipId === 'clipitem-26')).toMatchObject({ sourceKind: 'generator', matchMethod: 'generator' });

		const bd = computeBreakdown(segments, { durationFrames: t.sequence.durationFrames, fps: t.sequence.fps, includeOverlays: true });
		expect(bd.primary.byClass.captured_signed.frames).toBe(100);
		expect(bd.primary.byClass.generated.frames).toBe(100);
		expect(bd.primary.byClass.unknown.frames).toBe(140); // nested 40 + unmatched renamed clip 100
		expect(bd.primary.gap.frames).toBe(80);              // the disabled clip's slot, and 400-420 where only the V2 overlay runs
		expect(bd.audio.byClass.captured_signed.frames).toBe(100); // pair collapsed
		expect(sumPercent(bd.primary)).toBeCloseTo(100, 6);
	});
});
