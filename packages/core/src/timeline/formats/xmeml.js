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
// - A clip edge inside a transition is written as -1. The clip plays through
//   the transition, so a -1 start is the start of the transition before it
//   and a -1 end is the end of the transition after it. Without a transition
//   on the track, the edge comes from the clip's length (out - in).
// - The sequence <duration> can be shorter than the clips on it (seen in a
//   Premiere 2026 export whose rendered file ran to the last clip); the
//   duration is the later of the two.
import { XMLParser } from "fast-xml-parser";

export const id = "xmeml";
export const label = "Final Cut Pro XML (xmeml)";

export function detect(xmlText) {
	return /<xmeml[\s>]/.test(String(xmlText || "").slice(0, 2048));
}

// file://localhost/P%3a/video-provenance-test/assets/a%20b.mp4 -> P:/video-provenance-test/assets/a b.mp4
// file:///Users/me/clip.mov -> /Users/me/clip.mov
export function pathurlToPath(pathurl) {
	if (!pathurl) return "";
	let p = String(pathurl).trim();
	p = p
		.replace(/^file:\/\/localhost\//i, "")
		.replace(/^file:\/\/\//i, "")
		.replace(/^file:\/\//i, "");
	try {
		p = decodeURIComponent(p);
	} catch {
		/* leave as-is */
	}
	if (/^[A-Za-z]:/.test(p)) return p; // Windows drive path
	return p.startsWith("/") ? p : "/" + p;
}

const ARRAY_TAGS = new Set([
	"track",
	"clipitem",
	"file",
	"link",
	"transitionitem",
	"generatoritem",
	"clip",
	"sequence",
	"bin",
	"children",
]);

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	parseTagValue: false,
	trimValues: true,
	isArray: (name) => ARRAY_TAGS.has(name),
});

const num = (v, fallback = 0) => {
	if (v == null || v === "") return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
};
const bool = (v, fallback = true) => {
	if (v == null || v === "") return fallback;
	return String(v).toUpperCase() === "TRUE";
};
const text = (v) =>
	v == null ? "" : typeof v === "object" ? (v["#text"] ?? "") : String(v);
const first = (arr) => (Array.isArray(arr) ? arr[0] : arr);

// Walk the whole tree once and remember every <file> that carries a body.
function collectFileDefs(node, defs) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) collectFileDefs(n, defs);
		return;
	}
	for (const [key, val] of Object.entries(node)) {
		if (key === "file") {
			for (const f of Array.isArray(val) ? val : [val]) {
				const fid = f?.["@_id"];
				if (fid && (f.pathurl || f.name) && !defs.has(fid)) {
					const rate = first(f.rate);
					defs.set(fid, {
						id: fid,
						name: text(f.name),
						pathurl: text(f.pathurl),
						path: pathurlToPath(text(f.pathurl)),
						durationFrames: num(f.duration, null),
						timebase: rate ? num(rate.timebase, null) : null,
						ntsc: rate ? bool(rate.ntsc, false) : null,
					});
				}
				collectFileDefs(f, defs);
			}
		} else if (val && typeof val === "object") {
			collectFileDefs(val, defs);
		}
	}
}

function rateOf(node, fallback) {
	const rate = first(node?.rate);
	if (!rate) return fallback;
	const timebase = num(rate.timebase, fallback.timebase);
	const ntsc = bool(rate.ntsc, fallback.ntsc);
	return { timebase, ntsc, fps: ntsc ? (timebase * 1000) / 1001 : timebase };
}

function parseClip(item, fileDefs, notes) {
	const clip = {
		id: item["@_id"] || "",
		name: text(item.name),
		enabled: bool(item.enabled, true),
		startFrame: num(item.start, 0),
		endFrame: num(item.end, 0),
		inFrame: num(item.in, 0),
		outFrame: num(item.out, 0),
		sourceKind: "file",
		file: null,
		linkedClipIds: [],
	};
	for (const l of item.link || []) {
		const ref = text(l.linkclipref);
		if (ref && ref !== clip.id) clip.linkedClipIds.push(ref);
	}
	const f = first(item.file);
	if (f) {
		const fid = f["@_id"];
		const def = fid ? fileDefs.get(fid) : null;
		if (def)
			clip.file = {
				id: def.id,
				name: def.name,
				pathurl: def.pathurl,
				path: def.path,
				durationFrames: def.durationFrames,
			};
		else if (f.pathurl || f.name)
			clip.file = {
				id: fid || "",
				name: text(f.name),
				pathurl: text(f.pathurl),
				path: pathurlToPath(text(f.pathurl)),
				durationFrames: num(f.duration, null),
			};
		else
			notes.push(
				`clip ${clip.id} (${clip.name}) references file ${fid} which is never defined`,
			);
	} else if (item.sequence) {
		clip.sourceKind = "sequence";
		clip.nestedSequenceName = text(first(item.sequence)?.name);
	} else if (item.mediatype || item.effect) {
		clip.sourceKind = "generator";
	}
	return clip;
}

/**
 * Replace -1 clip edges (an edge inside a transition) with sequence frames.
 * Pure; exported for tests. `transitions` are [{ start, end }] on the same track.
 */
export function resolveTransitionEdges(clips, transitions, notes = []) {
	const ts = transitions.filter((t) => t.start >= 0 && t.end >= t.start);
	const length = (c) =>
		c.outFrame > c.inFrame ? c.outFrame - c.inFrame : null;
	const fromStartTransition = (end) =>
		ts
			.filter((t) => t.start < end && t.end <= end)
			.sort((a, b) => b.end - a.end)[0]?.start;
	const fromEndTransition = (start) =>
		ts
			.filter((t) => t.start >= start && t.end > start)
			.sort((a, b) => a.start - b.start)[0]?.end;
	for (const c of clips) {
		const startOpen = c.startFrame < 0;
		const endOpen = c.endFrame < 0;
		if (!startOpen && !endOpen) continue;
		if (startOpen && !endOpen)
			c.startFrame =
				fromStartTransition(c.endFrame) ??
				(length(c) != null ? c.endFrame - length(c) : -1);
		else if (endOpen && !startOpen)
			c.endFrame =
				fromEndTransition(c.startFrame) ??
				(length(c) != null ? c.startFrame + length(c) : -1);
		else {
			// Both edges in transitions: find the pair whose gap matches the clip's length.
			const len = length(c);
			const pair =
				len == null
					? null
					: ts
							.flatMap((a) =>
								ts.filter((b) => b.start > a.start).map((b) => [a, b]),
							)
							.find(([a, b]) => Math.abs(b.end - a.start - len) <= 1);
			if (pair) {
				c.startFrame = pair[0].start;
				c.endFrame = pair[1].end;
			}
		}
		if (c.startFrame < 0 || c.endFrame < 0) {
			notes.push(
				`clip ${c.id} (${c.name}) has an edge inside a transition that could not be placed; it is left out of screen time`,
			);
			c.startFrame = Math.max(c.startFrame, 0);
			c.endFrame = Math.max(c.endFrame, 0);
			if (c.endFrame <= c.startFrame) c.endFrame = c.startFrame;
		}
	}
	return clips;
}

function parseTracks(mediaNode, kind, fileDefs, notes) {
	const tracks = [];
	const list = mediaNode?.track || [];
	list.forEach((t, i) => {
		const clips = [];
		for (const item of t.clipitem || [])
			clips.push(parseClip(item, fileDefs, notes));
		for (const g of t.generatoritem || []) {
			clips.push({ ...parseClip(g, fileDefs, notes), sourceKind: "generator" });
		}
		const transitions = (t.transitionitem || []).map((x) => ({
			start: num(x.start, -1),
			end: num(x.end, -1),
		}));
		resolveTransitionEdges(clips, transitions, notes);
		clips.sort((a, b) => a.startFrame - b.startFrame);
		tracks.push({
			kind,
			index: i + 1,
			enabled: bool(t.enabled, true),
			locked: bool(t.locked, false),
			clips,
		});
	});
	return tracks;
}

/**
 * The sequences a file holds as sequences of its own: at the top level, then
 * in a project, then in the project's bins, bin by bin. A sequence nested
 * inside a clip is part of the sequence that uses it, never a choice.
 */
function ownSequences(root) {
	const out = [...(root.sequence || [])];
	const visit = (children) => {
		if (!children) return;
		out.push(...(children.sequence || []));
		for (const b of children.bin || []) visit(first(b.children));
	};
	const projects = Array.isArray(root.project)
		? root.project
		: root.project
			? [root.project]
			: [];
	for (const p of projects) visit(first(p.children));
	return out;
}

function readSequence(seq, fileDefs, notes) {
	const rate = rateOf(seq, { timebase: 30, ntsc: false, fps: 30 });
	const media = first(seq.media);
	const video = first(media?.video);
	const audio = first(media?.audio);
	const vformat = first(first(video?.format)?.samplecharacteristics);
	const tc = first(seq.timecode);

	const tracks = [
		...parseTracks(video, "video", fileDefs, notes),
		...parseTracks(audio, "audio", fileDefs, notes),
	];
	const declared = num(seq.duration, 0);
	const lastEnd = Math.max(
		0,
		...tracks.flatMap((t) =>
			t.clips.filter((c) => c.enabled).map((c) => c.endFrame),
		),
	);
	if (lastEnd > declared)
		notes.push(
			`the sequence declares ${declared} frames but its clips run to frame ${lastEnd}; using ${lastEnd}`,
		);
	return {
		sequence: {
			name: text(seq.name),
			timebase: rate.timebase,
			ntsc: rate.ntsc,
			fps: rate.fps,
			durationFrames: Math.max(declared, lastEnd),
			width: num(vformat?.width, 0),
			height: num(vformat?.height, 0),
			startTimecode: text(tc?.string) || "",
		},
		tracks,
	};
}

function documentOf(xmlText) {
	const doc = parser.parse(xmlText);
	const root = first(doc.xmeml);
	if (!root) throw new Error("not an xmeml document");
	const fileDefs = new Map();
	collectFileDefs(root, fileDefs);
	return { root, fileDefs, list: ownSequences(root) };
}

/**
 * Every sequence the file holds (Phase 8 step 6): a whole-project export
 * holds them all. { index, name, durationFrames, fps, seconds } each, in the
 * order ownSequences finds them; `index` is what parse's `sequence` option takes.
 */
export function sequences(xmlText) {
	return sequencesOf(documentOf(xmlText));
}

function sequencesOf({ fileDefs, list }) {
	return list.map((seq, index) => {
		const { sequence } = readSequence(seq, fileDefs, []);
		return {
			index,
			name: sequence.name,
			durationFrames: sequence.durationFrames,
			fps: sequence.fps,
			seconds: sequence.fps ? sequence.durationFrames / sequence.fps : null,
		};
	});
}

/**
 * Parse one sequence of the file: the one `opts.sequence` names by its index
 * in sequences(), or the first. Choosing among several is the caller's
 * (timeline/sequence-choice.ts), so a whole-project export is never read as
 * whichever sequence happens to come first without saying so.
 */
export function parse(xmlText, opts = {}) {
	return parseOf(documentOf(xmlText), opts);
}

/**
 * The file read once, for listing its sequences and then parsing the one
 * chosen: an import does both, and a whole-project export can be tens of
 * megabytes of XML.
 */
export function open(xmlText) {
	const doc = documentOf(xmlText);
	return {
		sequences: () => sequencesOf(doc),
		parse: (opts = {}) => parseOf(doc, opts),
	};
}

function parseOf({ root, fileDefs, list }, opts) {
	const version = root["@_version"] || "";
	const notes = [];
	if (!list.length) throw new Error("xmeml: no <sequence> found");
	const index = opts.sequence ?? 0;
	const seq = list[index];
	if (!seq)
		throw new Error(
			`xmeml: there is no sequence ${index}; the file holds ${list.length}`,
		);
	const { sequence, tracks } = readSequence(seq, fileDefs, notes);
	return { format: id, version, sequence, tracks, notes };
}
