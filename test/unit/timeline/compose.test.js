import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeLanes, intervalAt } from '../../../src/server/lib/timeline/compose.js';
import { segmentsFromTimeline } from '../../../src/server/lib/timeline/breakdown.js';
import { parse } from '../../../src/server/lib/timeline/formats/xmeml.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(path.resolve(here, '../../fixtures/timeline/sample.xmeml.xml'), 'utf8');
const FPS = 30000 / 1001;

let n = 0;
function seg(over) {
	n++;
	return { id: n, clipId: `c${n}`, name: `clip ${n}`, trackKind: 'video', trackIndex: 1, enabled: true, startFrame: 0, endFrame: 0, inFrame: 0, outFrame: 0, sourceKind: 'file', sourceKey: `s${n}`, matched: true, originClass: null, ...over };
}

const laneSum = (lane) => Object.values(lane.byClass).reduce((s, v) => s + v.percent, 0) + lane.mixed.percent + lane.gap.percent;
const tile = (lane) => lane.intervals.every((iv, i) => i === 0 ? iv.startFrame === 0 : iv.startFrame === lane.intervals[i - 1].endFrame);

describe('composeLanes picture', () => {
	const segments = [
		seg({ startFrame: 0, endFrame: 100, originClass: 'captured_signed' }),
		seg({ startFrame: 100, endFrame: 200, originClass: 'generated' }),
		seg({ startFrame: 200, endFrame: 260, originClass: 'generated', enabled: false }),
		seg({ startFrame: 260, endFrame: 300, sourceKind: 'sequence', matched: false }),
		seg({ trackIndex: 2, startFrame: 50, endFrame: 150, originClass: 'generated' }),       // graphic over camera, then over generated
		seg({ trackIndex: 3, startFrame: 280, endFrame: 400, originClass: 'archival' })         // top layer over the nested sequence, then alone
	];
	const c = composeLanes(segments, { durationFrames: 400, fps: FPS });
	const p = c.picture;

	it('tiles the whole duration and sums to 100', () => {
		expect(tile(p)).toBe(true);
		expect(p.intervals[0].startFrame).toBe(0);
		expect(p.intervals[p.intervals.length - 1].endFrame).toBe(400);
		expect(laneSum(p)).toBeCloseTo(100, 6);
		expect(c.durationSeconds).toBeCloseTo(400 / FPS, 6);
	});
	it('marks single, mixed and gap intervals with layers top track first', () => {
		const states = p.intervals.map(iv => [iv.startFrame, iv.endFrame, iv.state, iv.classes.join('+')]);
		expect(states).toEqual([
			[0, 50, 'single', 'captured_signed'],
			[50, 100, 'mixed', 'generated+captured_signed'],
			[100, 150, 'single', 'generated'],            // two layers, one class
			[150, 200, 'single', 'generated'],
			[200, 260, 'gap', ''],                          // the disabled clip is not a layer
			[260, 280, 'single', 'unknown'],                // nested sequence
			[280, 300, 'mixed', 'archival+unknown'],
			[300, 400, 'single', 'archival']
		]);
		expect(p.intervals[1].layers.map(l => l.trackIndex)).toEqual([2, 1]);
	});
	it('derives the numbers from the intervals', () => {
		expect(p.byClass.captured_signed.frames).toBe(50);
		expect(p.byClass.generated.frames).toBe(100);
		expect(p.byClass.unknown.frames).toBe(20);
		expect(p.byClass.archival.frames).toBe(100);
		expect(p.mixed.frames).toBe(70);
		expect(p.mixed.combos['captured_signed+generated'].frames).toBe(50);
		expect(p.mixed.combos['archival+unknown'].frames).toBe(20);
		expect(p.gap.frames).toBe(60);
		expect(p.gap.percent).toBeCloseTo(15, 6);
		expect(p.coveredFrames).toBe(340);
	});
	it('lists the tracks for the expanded view', () => {
		expect(p.tracks.map(t => t.index)).toEqual([1, 2, 3]);
		expect(p.tracks[0].clips.map(cl => cl.startFrame)).toEqual([0, 100, 260]);
		expect(p.tracks[0].clips[0]).toMatchObject({ originClass: 'captured_signed', startSeconds: 0, endSeconds: 100 / FPS });
	});
	it('clips layers to the sequence duration', () => {
		const o = composeLanes([seg({ startFrame: 350, endFrame: 420, originClass: 'captured' })], { durationFrames: 400, fps: FPS });
		expect(o.picture.byClass.captured.frames).toBe(50);
		expect(o.picture.gap.frames).toBe(350);
	});
	it('reports an empty lane as one gap', () => {
		const e = composeLanes([], { durationFrames: 100, fps: FPS });
		expect(e.picture.intervals).toEqual([expect.objectContaining({ startFrame: 0, endFrame: 100, state: 'gap' })]);
		expect(e.audio.gap.percent).toBe(100);
	});
});

describe('composeLanes audio', () => {
	it('counts a stereo pair once and mixes narration over a bed', () => {
		const segments = [
			seg({ trackKind: 'audio', trackIndex: 1, startFrame: 0, endFrame: 100, inFrame: 10, originClass: 'captured', sourceKey: 'voice' }),
			seg({ trackKind: 'audio', trackIndex: 2, startFrame: 0, endFrame: 100, inFrame: 10, originClass: 'captured', sourceKey: 'voice' }),
			seg({ trackKind: 'audio', trackIndex: 3, startFrame: 0, endFrame: 400, originClass: 'generated', sourceKey: 'bed' })
		];
		const a = composeLanes(segments, { durationFrames: 400, fps: FPS }).audio;
		expect(a.intervals.map(iv => [iv.startFrame, iv.endFrame, iv.state])).toEqual([[0, 100, 'mixed'], [100, 400, 'single']]);
		expect(a.intervals[0].layers.length).toBe(2);                 // bed + one half of the pair
		expect(a.intervals[0].classes).toEqual(['generated', 'captured']);
		expect(a.mixed.combos['captured+generated'].frames).toBe(100);
		expect(a.byClass.generated.frames).toBe(300);
		expect(a.tracks.map(t => t.index)).toEqual([1, 3]);          // the pair's second track is folded into the first
		expect(laneSum(a)).toBeCloseTo(100, 6);
	});
	it('keeps picture and audio apart', () => {
		const c = composeLanes([seg({ startFrame: 0, endFrame: 100, originClass: 'generated' }), seg({ trackKind: 'audio', startFrame: 0, endFrame: 100, originClass: 'captured' })], { durationFrames: 100, fps: FPS });
		expect(c.picture.byClass.generated.frames).toBe(100);
		expect(c.audio.byClass.captured.frames).toBe(100);
		expect(c.picture.byClass.captured).toBeUndefined();
	});
});

describe('intervalAt', () => {
	const lane = composeLanes([seg({ startFrame: 0, endFrame: 100, originClass: 'generated' }), seg({ startFrame: 100, endFrame: 200, originClass: 'captured' })], { durationFrames: 200, fps: 10 }).picture;
	it('finds the interval containing a moment, including the last frame', () => {
		expect(intervalAt(lane, 0).classes).toEqual(['generated']);
		expect(intervalAt(lane, 9.99).classes).toEqual(['generated']);
		expect(intervalAt(lane, 10).classes).toEqual(['captured']);
		expect(intervalAt(lane, 20).classes).toEqual(['captured']);
		expect(intervalAt(lane, null)).toBeNull();
	});
});

describe('composeLanes from the parsed sample', () => {
	it('composes the fixture with its overlays and stereo pair', () => {
		const t = parse(SAMPLE);
		const matches = new Map([
			['clipitem-21', { asset: { type: 'produced', id: 1, originClass: 'captured_signed' }, method: 'path', confidence: 1 }],
			['clipitem-31', { asset: { type: 'produced', id: 1, originClass: 'captured_signed' }, method: 'path', confidence: 1 }],
			['clipitem-32', { asset: { type: 'produced', id: 1, originClass: 'captured_signed' }, method: 'path', confidence: 1 }],
			['clipitem-22', { asset: { type: 'ai', id: 2, originClass: 'generated' }, method: 'hash', confidence: 1 }],
			['clipitem-27', { asset: { type: 'ai', id: 5, originClass: 'generated' }, method: 'filename', confidence: 0.4 }]
		]);
		const c = composeLanes(segmentsFromTimeline(t, matches), { durationFrames: t.sequence.durationFrames, fps: t.sequence.fps });
		const p = c.picture;
		expect(tile(p)).toBe(true);
		expect(laneSum(p)).toBeCloseTo(100, 6);
		// Lower third (generator, unknown) over the signed capture at 50-80.
		const lt = intervalAt(p, 60 / t.sequence.fps);
		expect(lt).toMatchObject({ startFrame: 50, endFrame: 80, state: 'mixed' });
		expect(lt.layers.map(l => l.trackIndex)).toEqual([2, 1]);
		// Overlay 05 (generated, weak match) over the unmatched renamed clip from 350.
		expect(intervalAt(p, 360 / t.sequence.fps)).toMatchObject({ state: 'mixed', classes: ['generated', 'unknown'] });
		expect(p.gap.frames).toBe(60);
		expect(c.audio.byClass.captured_signed.frames).toBe(100);
		expect(c.audio.tracks.length).toBe(1);
	});
});
