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

describe('xmeml parse', () => {
	const t = xmeml.parse(SAMPLE);
	const v1 = t.tracks.find(x => x.kind === 'video' && x.index === 1);
	const v2 = t.tracks.find(x => x.kind === 'video' && x.index === 2);
	const audio = t.tracks.filter(x => x.kind === 'audio');

	it('reads the sequence header with NTSC frame rate', () => {
		expect(t.format).toBe('xmeml');
		expect(t.version).toBe('4');
		expect(t.sequence.name).toBe('Sample Sequence');
		expect(t.sequence.durationFrames).toBe(400);
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
		expect(t.notes).toEqual([]);
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
