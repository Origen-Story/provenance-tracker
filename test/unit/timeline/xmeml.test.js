import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xmeml from '../../../src/server/lib/timeline/formats/xmeml.js';
import { detectFormat, parseTimeline, formats } from '../../../src/server/lib/timeline/formats/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(path.resolve(here, '../../fixtures/timeline/sample.xmeml.xml'), 'utf8');

describe('xmeml detect and registry', () => {
	it('detects an xmeml document and nothing else', () => {
		expect(xmeml.detect(SAMPLE)).toBe(true);
		expect(xmeml.detect('<?xml version="1.0"?><fcpxml version="1.11"></fcpxml>')).toBe(false);
		expect(xmeml.detect('')).toBe(false);
	});
	it('the registry routes to xmeml and rejects unknown text', () => {
		expect(formats.map(f => f.id)).toContain('xmeml');
		expect(detectFormat(SAMPLE)?.id).toBe('xmeml');
		expect(() => parseTimeline('TITLE: edl')).toThrow(/Unrecognised/);
	});
});

describe('pathurlToPath', () => {
	it('decodes Premiere Windows paths', () => {
		expect(xmeml.pathurlToPath('file://localhost/P%3a/Demo%20Project/assets/Clip%2001.mp4')).toBe('P:/Demo Project/assets/Clip 01.mp4');
	});
	it('decodes posix paths and leaves empty alone', () => {
		expect(xmeml.pathurlToPath('file:///Users/me/clip.mov')).toBe('/Users/me/clip.mov');
		expect(xmeml.pathurlToPath('file://localhost/Volumes/Media/a%20b.mov')).toBe('/Volumes/Media/a b.mov');
		expect(xmeml.pathurlToPath('')).toBe('');
	});
});

// Shapes from a real Premiere 2026 export: clip edges inside transitions are
// -1, and the sequence <duration> stopped short of the last clip.
const clip = (id, start, end, inF, outF) => `<clipitem id="${id}"><name>${id}.mp4</name><enabled>TRUE</enabled><start>${start}</start><end>${end}</end><in>${inF}</in><out>${outF}</out><file id="f-${id}"><name>${id}.mp4</name><pathurl>file://localhost/P%3a/demo/${id}.mp4</pathurl></file></clipitem>`;
const transition = (start, end, alignment) => `<transitionitem><start>${start}</start><end>${end}</end><alignment>${alignment}</alignment></transitionitem>`;
const TRANSITIONS = `<?xml version="1.0"?><xmeml version="4"><sequence id="s1"><name>Edges</name><duration>4166</duration><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate><media>
<video>
<track>${clip('a', 939, -1, 5890, 5972)}${transition(1013, 1021, 'center')}${clip('b', -1, 1075, 5974, 6036)}${clip('c', 1075, -1, 6036, 6054)}${transition(1083, 1093, 'center')}${clip('d', -1, 1153, 6057, 6126)}</track>
<track>${transition(4061, 4079, 'start-black')}${clip('end-plate', -1, 4375, 46, 360)}</track>
<track>${clip('no-transition', -1, 300, 0, 100)}</track>
</video></media></sequence></xmeml>`;

describe('xmeml clip edges inside transitions', () => {
	const t = xmeml.parse(TRANSITIONS);
	const byId = Object.fromEntries(t.tracks.flatMap(tr => tr.clips).map(c => [c.id, [c.startFrame, c.endFrame]]));
	it('runs a clip through the transition on either side of it', () => {
		expect(byId.a).toEqual([939, 1021]);
		expect(byId.b).toEqual([1013, 1075]);
		expect(byId.c).toEqual([1075, 1093]);
		expect(byId.d).toEqual([1083, 1153]);
	});
	it('starts a fade-in clip at its transition, not at frame 0', () => {
		expect(byId['end-plate']).toEqual([4061, 4375]);
	});
	it('falls back to the clip length when the track has no transition', () => {
		expect(byId['no-transition']).toEqual([200, 300]);
	});
	it('extends the sequence to its last clip and says so', () => {
		expect(t.sequence.durationFrames).toBe(4375);
		expect(t.notes.join(' ')).toMatch(/declares 4166 frames .* frame 4375/);
	});
	it('leaves an edge it cannot place out of screen time, with a note', () => {
		const notes = [];
		const [c] = xmeml.resolveTransitionEdges([{ id: 'x', name: 'x', startFrame: -1, endFrame: -1, inFrame: 0, outFrame: 0 }], [], notes);
		expect([c.startFrame, c.endFrame]).toEqual([0, 0]);
		expect(notes[0]).toMatch(/could not be placed/);
	});
});

describe('xmeml parse', () => {
	const t = xmeml.parse(SAMPLE);
	const v1 = t.tracks.find(x => x.kind === 'video' && x.index === 1);
	const v2 = t.tracks.find(x => x.kind === 'video' && x.index === 2);
	const audio = t.tracks.filter(x => x.kind === 'audio');

	it('reads the sequence header with NTSC frame rate', () => {
		expect(t.format).toBe('xmeml');
		expect(t.version).toBe('4');
		expect(t.sequence.name).toBe('Sample Sequence');
		expect(t.sequence.durationFrames).toBe(420); // declares 400; the V2 overlay runs to 420
		expect(t.sequence.timebase).toBe(30);
		expect(t.sequence.ntsc).toBe(true);
		expect(t.sequence.fps).toBeCloseTo(29.97, 2);
		expect(t.sequence.width).toBe(1920);
		expect(t.sequence.startTimecode).toBe('00;00;00;00');
	});

	it('keeps every clip on V1 in order, including disabled and nested ones, and drops the transition', () => {
		expect(v1.clips.map(c => c.id)).toEqual(['clipitem-21', 'clipitem-22', 'clipitem-23', 'clipitem-24', 'clipitem-25']);
		expect(v1.clips.find(c => c.id === 'clipitem-23').enabled).toBe(false);
		expect(v1.clips.find(c => c.id === 'clipitem-24')).toMatchObject({ sourceKind: 'sequence', nestedSequenceName: 'Nested Sequence', file: null });
		expect(JSON.stringify(t)).not.toContain('Cross Dissolve');
	});

	it('resolves file back-references to the master-clip definitions', () => {
		const first = v1.clips[0];
		expect(first.file).toMatchObject({ id: 'file-1', name: 'Clip 01.mp4', path: 'P:/Demo Project/assets/Clip 01.mp4', durationFrames: 300 });
		expect(first).toMatchObject({ startFrame: 0, endFrame: 100, inFrame: 10, outFrame: 110 });
		const renamed = v1.clips.find(c => c.id === 'clipitem-25');
		expect(renamed.file.path).toBe('P:/Demo Project/assets/Renamed 04.mp4');
		expect(t.notes).toEqual(['the sequence declares 400 frames but its clips run to frame 420; using 420']);
	});

	it('keeps still-image in/out offsets but sequence start/end are what matter', () => {
		const still = v1.clips.find(c => c.id === 'clipitem-22');
		expect(still.inFrame).toBe(107892);
		expect(still.endFrame - still.startFrame).toBe(100);
	});

	it('reads V2 generators and overlay clips', () => {
		expect(v2.clips.map(c => [c.id, c.sourceKind])).toEqual([['clipitem-26', 'generator'], ['clipitem-27', 'file']]);
		expect(v2.clips[1].endFrame).toBe(420); // runs past the sequence end; breakdown clips it
	});

	it('keeps both halves of a stereo-exploded pair with their links', () => {
		expect(audio.length).toBe(2);
		expect(audio[0].clips[0].id).toBe('clipitem-31');
		expect(audio[1].clips[0].id).toBe('clipitem-32');
		expect(audio[0].clips[0].linkedClipIds).toEqual(['clipitem-21', 'clipitem-32']);
		expect(audio[0].clips[0].file.id).toBe('file-1');
	});

	it('throws on a document without a sequence', () => {
		expect(() => xmeml.parse('<xmeml version="4"><project><name>x</name></project></xmeml>')).toThrow(/no <sequence>/);
	});
});
