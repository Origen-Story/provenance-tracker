// Pure: screen time per origin class for a parsed timeline.
//
// Input segments are flat rows (one per clip on a track):
//   { trackKind: 'video'|'audio', trackIndex, enabled, startFrame, endFrame,
//     inFrame, outFrame, sourceKind: 'file'|'sequence'|'generator',
//     sourceKey: string|null,   // stable id of the referenced file (for stereo-pair dedupe)
//     matched: boolean, originClass: string|null }
//
// Rules (decisions D3, D7):
// - The primary picture track (V1 by default) decides the headline numbers.
//   Frames per class are summed from enabled clips, clipped to the sequence
//   duration; frames no clip covers are reported as `gap`. Percentages are of
//   the sequence duration, so classes + gap = 100.
// - Unmatched clips count as `unknown`. Nested sequences and generators
//   (titles, mattes) also count as `unknown` unless a class was set by hand.
// - Overlay mode sweeps every enabled video track and lets the top-most
//   clip win per interval; reported separately, never mixed into primary.
// - Audio is reported per class with stereo-exploded pairs collapsed (same
//   source, same position), as frames and as a share of the timeline.

import { composeLanes } from './compose.js';

export function classOfSegment(seg) {
	if (seg.originClass) return seg.originClass;
	return 'unknown';
}

function clip(seg, durationFrames) {
	const start = Math.max(0, seg.startFrame);
	const end = Math.min(durationFrames, seg.endFrame);
	return end > start ? [start, end] : null;
}

function tally(byClass, cls, frames) {
	byClass[cls] = (byClass[cls] || 0) + frames;
}

function finish(byClass, durationFrames, fps, coveredFrames) {
	const out = {};
	for (const [cls, frames] of Object.entries(byClass)) {
		out[cls] = { frames, seconds: fps ? frames / fps : null, percent: durationFrames ? (frames / durationFrames) * 100 : 0 };
	}
	const gapFrames = Math.max(0, durationFrames - coveredFrames);
	return {
		byClass: out,
		coveredFrames,
		gap: { frames: gapFrames, seconds: fps ? gapFrames / fps : null, percent: durationFrames ? (gapFrames / durationFrames) * 100 : 0 }
	};
}

function primaryBreakdown(segments, durationFrames, fps, primaryTrackIndex) {
	const byClass = {};
	let covered = 0;
	for (const seg of segments) {
		if (seg.trackKind !== 'video' || seg.trackIndex !== primaryTrackIndex || !seg.enabled) continue;
		const r = clip(seg, durationFrames);
		if (!r) continue;
		const frames = r[1] - r[0];
		tally(byClass, classOfSegment(seg), frames);
		covered += frames;
	}
	return { trackIndex: primaryTrackIndex, ...finish(byClass, durationFrames, fps, Math.min(covered, durationFrames)) };
}

// Sweep: at every breakpoint pick the enabled clip on the highest video track.
function overlayBreakdown(segments, durationFrames, fps) {
	const vids = segments.filter(s => s.trackKind === 'video' && s.enabled).map(s => ({ s, r: clip(s, durationFrames) })).filter(x => x.r);
	const points = new Set([0, durationFrames]);
	for (const { r } of vids) { points.add(r[0]); points.add(r[1]); }
	const sorted = [...points].sort((a, b) => a - b);
	const byClass = {};
	let covered = 0;
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i], b = sorted[i + 1];
		if (b <= a) continue;
		let top = null;
		for (const { s, r } of vids) {
			if (r[0] <= a && r[1] >= b && (!top || s.trackIndex > top.trackIndex)) top = s;
		}
		if (!top) continue;
		tally(byClass, classOfSegment(top), b - a);
		covered += b - a;
	}
	return finish(byClass, durationFrames, fps, covered);
}

function audioBreakdown(segments, durationFrames, fps) {
	const seen = new Set();
	const byClass = {};
	const tracks = {};
	let total = 0;
	for (const seg of segments) {
		if (seg.trackKind !== 'audio' || !seg.enabled) continue;
		const r = clip(seg, durationFrames);
		if (!r) continue;
		const frames = r[1] - r[0];
		const cls = classOfSegment(seg);
		const t = tracks[seg.trackIndex] || (tracks[seg.trackIndex] = { index: seg.trackIndex, frames: 0, byClass: {} });
		t.frames += frames;
		tally(t.byClass, cls, frames);
		// Stereo-exploded pairs: same source at the same position on another track.
		const key = `${seg.sourceKey || seg.name || ''}|${r[0]}|${r[1]}|${seg.inFrame ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		tally(byClass, cls, frames);
		total += frames;
	}
	const out = {};
	for (const [cls, frames] of Object.entries(byClass)) {
		out[cls] = { frames, seconds: fps ? frames / fps : null, percentOfTimeline: durationFrames ? (frames / durationFrames) * 100 : 0 };
	}
	return { byClass: out, totalFrames: total, tracks: Object.values(tracks).sort((a, b) => a.index - b.index) };
}

export function computeBreakdown(segments, { durationFrames, fps, primaryTrackIndex = 1, includeOverlays = false }) {
	const segs = segments || [];
	const counts = {
		segments: segs.length,
		unmatched: segs.filter(s => !s.matched && s.sourceKind === 'file').length,
		generators: segs.filter(s => s.sourceKind === 'generator').length,
		nested: segs.filter(s => s.sourceKind === 'sequence').length,
		disabled: segs.filter(s => !s.enabled).length
	};
	return {
		durationFrames,
		fps,
		durationSeconds: fps ? durationFrames / fps : null,
		primary: primaryBreakdown(segs, durationFrames, fps, primaryTrackIndex),
		overlays: includeOverlays ? overlayBreakdown(segs, durationFrames, fps) : null,
		audio: audioBreakdown(segs, durationFrames, fps),
		// What is on screen and audible at each moment, across all tracks (D10).
		// The UI and the public export read this; primary/overlays/audio above
		// are the per-track tallies kept for the record.
		composition: composeLanes(segs, { durationFrames, fps }),
		counts
	};
}

// Flatten a parsed timeline (formats/*.js shape) into breakdown segments,
// attaching match results keyed by clip id: { asset, method, confidence }.
export function segmentsFromTimeline(timeline, matchesByClipId = new Map()) {
	const out = [];
	for (const track of timeline.tracks) {
		for (const c of track.clips) {
			const m = matchesByClipId.get(c.id);
			out.push({
				clipId: c.id,
				name: c.name,
				trackKind: track.kind,
				trackIndex: track.index,
				enabled: track.enabled && c.enabled,
				startFrame: c.startFrame,
				endFrame: c.endFrame,
				inFrame: c.inFrame,
				outFrame: c.outFrame,
				sourceKind: c.sourceKind,
				sourceKey: c.file?.id || c.file?.path || null,
				sourceName: c.file?.name || c.nestedSequenceName || c.name,
				sourcePath: c.file?.path || '',
				matched: !!m?.asset,
				matchMethod: m?.method || (c.sourceKind === 'file' ? 'unmatched' : c.sourceKind),
				matchConfidence: m?.confidence ?? 0,
				matchedAssetType: m?.asset?.type || null,
				matchedAssetId: m?.asset?.id || null,
				originClass: m?.asset?.originClass || null
			});
		}
	}
	return out;
}
