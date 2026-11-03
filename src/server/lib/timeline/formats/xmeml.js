// Timeline format: xmeml (Final Cut Pro 7 XML). Premiere Pro exports it as
// "Final Cut Pro XML"; DaVinci Resolve exports it too. Decision D2.
//
// Pure: text in, normalised timeline out. The shape is shared by every
// format module (see ./index.js):
//
//   { format, version, sequence: { name, timebase, ntsc, fps, durationFrames,
//     width, height, startTimecode },
//     tracks: [{ kind: 'video'|'audio', index, enabled, locked,
//       clips: [{ id, name, enabled, startFrame, endFrame, inFrame, outFrame,
//         sourceKind: 'file'|'sequence'|'generator', file: { id, name,
//         pathurl, path, durationFrames } | null, linkedClipIds: [] }] }],
//     notes: [] }
//
// Things learned from a real Premiere 2026 export (test-fixtures/timeline):
// - <file> is defined once, in the project's master-clip list at the top or
//   at first use, and referenced later as <file id="x"/>. A first pass over
//   the whole document collects definitions.
// - Stereo audio is "exploded" into one track per channel; both tracks hold
//   a clipitem for the same file at the same position, joined by <link>.
//   The parser keeps both (it is faithful to the document); the breakdown
//   collapses them.
// - Still images get a huge source duration and in/out offsets around
//   107892; only start/end on the sequence matter for screen time.
// - pathurl is file://localhost/P%3a/... with a percent-encoded drive colon.
import { XMLParser } from 'fast-xml-parser';

export const id = 'xmeml';
export const label = 'Final Cut Pro XML (xmeml)';

export function detect(xmlText) {
	return /<xmeml[\s>]/.test(String(xmlText || '').slice(0, 2048));
}

// file://localhost/P%3a/video-provenance-test/assets/a%20b.mp4 -> P:/video-provenance-test/assets/a b.mp4
// file:///Users/me/clip.mov -> /Users/me/clip.mov
export function pathurlToPath(pathurl) {
	if (!pathurl) return '';
	let p = String(pathurl).trim();
	p = p.replace(/^file:\/\/localhost\//i, '').replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '');
	try { p = decodeURIComponent(p); } catch { /* leave as-is */ }
	if (/^[A-Za-z]:/.test(p)) return p; // Windows drive path
	return p.startsWith('/') ? p : '/' + p;
}

const ARRAY_TAGS = new Set(['track', 'clipitem', 'file', 'link', 'transitionitem', 'generatoritem', 'clip', 'sequence', 'bin', 'children']);

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	parseTagValue: false,
	trimValues: true,
	isArray: (name) => ARRAY_TAGS.has(name)
});

const num = (v, fallback = 0) => {
	if (v == null || v === '') return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
};
const bool = (v, fallback = true) => {
	if (v == null || v === '') return fallback;
	return String(v).toUpperCase() === 'TRUE';
};
const text = (v) => (v == null ? '' : typeof v === 'object' ? (v['#text'] ?? '') : String(v));
const first = (arr) => (Array.isArray(arr) ? arr[0] : arr);

// Walk the whole tree once and remember every <file> that carries a body.
function collectFileDefs(node, defs) {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) { for (const n of node) collectFileDefs(n, defs); return; }
	for (const [key, val] of Object.entries(node)) {
		if (key === 'file') {
			for (const f of Array.isArray(val) ? val : [val]) {
				const fid = f?.['@_id'];
				if (fid && (f.pathurl || f.name) && !defs.has(fid)) {
					const rate = first(f.rate);
					defs.set(fid, {
						id: fid,
						name: text(f.name),
						pathurl: text(f.pathurl),
						path: pathurlToPath(text(f.pathurl)),
						durationFrames: num(f.duration, null),
						timebase: rate ? num(rate.timebase, null) : null,
						ntsc: rate ? bool(rate.ntsc, false) : null
					});
				}
				collectFileDefs(f, defs);
			}
		} else if (val && typeof val === 'object') {
			collectFileDefs(val, defs);
		}
	}
}

function rateOf(node, fallback) {
	const rate = first(node?.rate);
	if (!rate) return fallback;
	const timebase = num(rate.timebase, fallback.timebase);
	const ntsc = bool(rate.ntsc, fallback.ntsc);
	return { timebase, ntsc, fps: ntsc ? timebase * 1000 / 1001 : timebase };
}

function parseClip(item, fileDefs, notes) {
	const clip = {
		id: item['@_id'] || '',
		name: text(item.name),
		enabled: bool(item.enabled, true),
		startFrame: num(item.start, 0),
		endFrame: num(item.end, 0),
		inFrame: num(item.in, 0),
		outFrame: num(item.out, 0),
		sourceKind: 'file',
		file: null,
		linkedClipIds: []
	};
	for (const l of item.link || []) {
		const ref = text(l.linkclipref);
		if (ref && ref !== clip.id) clip.linkedClipIds.push(ref);
	}
	const f = first(item.file);
	if (f) {
		const fid = f['@_id'];
		const def = fid ? fileDefs.get(fid) : null;
		if (def) clip.file = { id: def.id, name: def.name, pathurl: def.pathurl, path: def.path, durationFrames: def.durationFrames };
		else if (f.pathurl || f.name) clip.file = { id: fid || '', name: text(f.name), pathurl: text(f.pathurl), path: pathurlToPath(text(f.pathurl)), durationFrames: num(f.duration, null) };
		else notes.push(`clip ${clip.id} (${clip.name}) references file ${fid} which is never defined`);
	} else if (item.sequence) {
		clip.sourceKind = 'sequence';
		clip.nestedSequenceName = text(first(item.sequence)?.name);
	} else if (item.mediatype || item.effect) {
		clip.sourceKind = 'generator';
	}
	return clip;
}

function parseTracks(mediaNode, kind, fileDefs, notes) {
	const tracks = [];
	const list = mediaNode?.track || [];
	list.forEach((t, i) => {
		const clips = [];
		for (const item of t.clipitem || []) clips.push(parseClip(item, fileDefs, notes));
		for (const g of t.generatoritem || []) {
			clips.push({ ...parseClip(g, fileDefs, notes), sourceKind: 'generator' });
		}
		clips.sort((a, b) => a.startFrame - b.startFrame);
		tracks.push({
			kind,
			index: i + 1,
			enabled: bool(t.enabled, true),
			locked: bool(t.locked, false),
			clips
		});
	});
	return tracks;
}

export function parse(xmlText) {
	const doc = parser.parse(xmlText);
	const root = first(doc.xmeml);
	if (!root) throw new Error('not an xmeml document');
	const version = root['@_version'] || '';
	const notes = [];

	const fileDefs = new Map();
	collectFileDefs(root, fileDefs);

	// The main sequence: top-level, or the first inside project/children.
	let seq = first(root.sequence);
	if (!seq) {
		const project = first(root.project);
		const children = first(project?.children);
		seq = first(children?.sequence);
		if (!seq) {
			// Some exports nest sequences inside bins.
			const stack = [children];
			while (stack.length && !seq) {
				const n = stack.pop();
				if (!n) continue;
				if (n.sequence) { seq = first(n.sequence); break; }
				for (const b of n.bin || []) stack.push(first(b.children));
			}
		}
	}
	if (!seq) throw new Error('xmeml: no <sequence> found');

	const rate = rateOf(seq, { timebase: 30, ntsc: false, fps: 30 });
	const media = first(seq.media);
	const video = first(media?.video);
	const audio = first(media?.audio);
	const vformat = first(first(video?.format)?.samplecharacteristics);
	const tc = first(seq.timecode);

	const tracks = [
		...parseTracks(video, 'video', fileDefs, notes),
		...parseTracks(audio, 'audio', fileDefs, notes)
	];

	return {
		format: id,
		version,
		sequence: {
			name: text(seq.name),
			timebase: rate.timebase,
			ntsc: rate.ntsc,
			fps: rate.fps,
			durationFrames: num(seq.duration, 0),
			width: num(vformat?.width, 0),
			height: num(vformat?.height, 0),
			startTimecode: text(tc?.string) || ''
		},
		tracks,
		notes
	};
}
