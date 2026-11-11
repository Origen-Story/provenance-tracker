// Pure: what is on screen, and what is audible, at every moment of a
// timeline (decisions D10 and D11).
//
// Takes the same flat segment rows as breakdown.js and returns two lanes,
// picture and audio. Each lane is a list of intervals that tile the sequence
// duration. Layers are compared by spectrum position (how much generative AI
// is in them), not by class: an interval is `single` when every layer playing
// in it sits at the same position, `mixed` when two or more positions play at
// once (a generated music bed under captured narration; an AI-assisted
// graphic over a camera shot), and `gap` when nothing plays. A scan over a
// camera shot is two classes at one position and stays `single`. The numbers
// (frames and percentages per position, per mix, and gap) are derived from
// the same intervals, so the strip and the summary cannot disagree.
//
// Layer rules:
// - Disabled clips are not layers.
// - Unmatched clips and nested sequences are `unknown` unless a class was
//   set; a title or other generator made in the editor is `digitalCreation`.
// - Audio that an NLE exploded into a stereo pair (same source, same
//   position on two tracks) is one layer, not two.
// - Within an interval, layers are listed top track first.

import { classOfSegment } from './breakdown.js';
import { spectrumPosition } from '../../../shared/origin-vocabulary.js';

const LANE_KINDS = { picture: 'video', audio: 'audio' };

function clipToDuration(seg, durationFrames) {
	const start = Math.max(0, seg.startFrame);
	const end = Math.min(durationFrames, seg.endFrame);
	return end > start ? [start, end] : null;
}

function layersOf(segments, kind, durationFrames) {
	const seen = new Set();
	const out = [];
	for (const seg of segments) {
		if (seg.trackKind !== kind || !seg.enabled) continue;
		const r = clipToDuration(seg, durationFrames);
		if (!r) continue;
		if (kind === 'audio') {
			const key = `${seg.sourceKey || seg.name || ''}|${r[0]}|${r[1]}|${seg.inFrame ?? ''}`;
			if (seen.has(key)) continue;
			seen.add(key);
		}
		const originClass = classOfSegment(seg);
		const aiAssisted = !!seg.aiAssisted;
		out.push({
			trackIndex: seg.trackIndex,
			clipId: seg.clipId ?? null,
			segmentId: seg.id ?? null,
			name: seg.name || seg.sourceName || '',
			startFrame: r[0],
			endFrame: r[1],
			originClass,
			aiAssisted,
			position: spectrumPosition(originClass, { aiAssisted }),
			matched: !!seg.matched,
			matchedAssetType: seg.matchedAssetType || null,
			matchedAssetId: seg.matchedAssetId || null
		});
	}
	return out;
}

function timed(frames, fps) {
	return fps ? frames / fps : null;
}

function sameLayers(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].trackIndex !== b[i].trackIndex || a[i].clipId !== b[i].clipId || a[i].segmentId !== b[i].segmentId) return false;
	}
	return true;
}

function composeLane(layers, durationFrames, fps) {
	const points = new Set([0, durationFrames]);
	for (const l of layers) { points.add(l.startFrame); points.add(l.endFrame); }
	const sorted = [...points].filter(p => p >= 0 && p <= durationFrames).sort((a, b) => a - b);

	const intervals = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i], b = sorted[i + 1];
		if (b <= a) continue;
		const active = layers.filter(l => l.startFrame <= a && l.endFrame >= b).sort((x, y) => y.trackIndex - x.trackIndex);
		const positions = [...new Set(active.map(l => l.position))];
		const classes = [...new Set(active.map(l => l.originClass))];
		const state = active.length === 0 ? 'gap' : positions.length === 1 ? 'single' : 'mixed';
		const prev = intervals[intervals.length - 1];
		if (prev && prev.endFrame === a && prev.state === state && sameLayers(prev.layers, active)) {
			prev.endFrame = b;
			continue;
		}
		intervals.push({ startFrame: a, endFrame: b, state, positions, classes, layers: active });
	}

	const byPosition = {};
	const combos = {};
	let mixedFrames = 0;
	let gapFrames = 0;
	for (const iv of intervals) {
		const frames = iv.endFrame - iv.startFrame;
		if (iv.state === 'gap') gapFrames += frames;
		else if (iv.state === 'single') byPosition[iv.positions[0]] = (byPosition[iv.positions[0]] || 0) + frames;
		else {
			mixedFrames += frames;
			const key = [...iv.positions].sort().join('+');
			combos[key] = (combos[key] || 0) + frames;
		}
	}
	const stat = (frames) => ({ frames, seconds: timed(frames, fps), percent: durationFrames ? (frames / durationFrames) * 100 : 0 });
	const tracks = {};
	for (const l of layers) {
		const t = tracks[l.trackIndex] || (tracks[l.trackIndex] = { index: l.trackIndex, clips: [] });
		t.clips.push({ ...l, startSeconds: timed(l.startFrame, fps), endSeconds: timed(l.endFrame, fps) });
	}

	return {
		intervals: intervals.map(iv => ({
			...iv,
			startSeconds: timed(iv.startFrame, fps),
			endSeconds: timed(iv.endFrame, fps),
			layers: iv.layers.map(l => ({ trackIndex: l.trackIndex, clipId: l.clipId, segmentId: l.segmentId, name: l.name, originClass: l.originClass, aiAssisted: l.aiAssisted, position: l.position, matched: l.matched, matchedAssetType: l.matchedAssetType, matchedAssetId: l.matchedAssetId }))
		})),
		tracks: Object.values(tracks).sort((a, b) => a.index - b.index).map(t => ({ ...t, clips: t.clips.sort((a, b) => a.startFrame - b.startFrame) })),
		byPosition: Object.fromEntries(Object.entries(byPosition).map(([p, frames]) => [p, stat(frames)])),
		mixed: { ...stat(mixedFrames), combos: Object.fromEntries(Object.entries(combos).map(([k, frames]) => [k, stat(frames)])) },
		gap: stat(gapFrames),
		coveredFrames: durationFrames - gapFrames
	};
}

/**
 * @param {Array} segments  breakdown.js segment rows
 * @param {{durationFrames:number, fps:number|null}} opts
 * @returns {{durationFrames:number, fps:number|null, durationSeconds:number|null, picture:object, audio:object}}
 */
export function composeLanes(segments, { durationFrames, fps }) {
	const segs = segments || [];
	const lanes = {};
	for (const [lane, kind] of Object.entries(LANE_KINDS)) {
		lanes[lane] = composeLane(layersOf(segs, kind, durationFrames), durationFrames, fps);
	}
	return { durationFrames, fps, durationSeconds: timed(durationFrames, fps), ...lanes };
}

// Every spectrum position that plays anywhere in a composition, both lanes.
// Feeds compositeClassFor to name the finished edit.
export function positionsIn(composition) {
	const out = new Set();
	for (const lane of [composition?.picture, composition?.audio]) {
		for (const iv of lane?.intervals || []) for (const p of iv.positions || []) out.add(p);
	}
	return [...out];
}

// The interval of a lane that contains a moment, in seconds. Used by the
// readout under the player; exported so the public viewer can share it.
export function intervalAt(lane, seconds) {
	if (!lane || seconds == null) return null;
	const ivs = lane.intervals || [];
	for (const iv of ivs) {
		if (iv.startSeconds != null && seconds >= iv.startSeconds && seconds < iv.endSeconds) return iv;
	}
	return ivs.length && seconds >= ivs[ivs.length - 1].endSeconds ? ivs[ivs.length - 1] : null;
}
