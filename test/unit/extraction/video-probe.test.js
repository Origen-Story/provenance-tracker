import { describe, it, expect } from 'vitest';
import { parseDurationSeconds, probeVideoTags } from '../../../src/server/lib/extraction/video-probe.js';

describe('parseDurationSeconds', () => {
	it('accepts seconds as a number', () => {
		expect(parseDurationSeconds(1.2309)).toBeCloseTo(1.2309);
	});
	it('parses h:mm:ss and fractional clock strings', () => {
		expect(parseDurationSeconds('0:00:40')).toBe(40);
		expect(parseDurationSeconds('0:01:00')).toBe(60);
		expect(parseDurationSeconds('1:02:03.5')).toBe(3723.5);
	});
	it('parses "N s" strings', () => {
		expect(parseDurationSeconds('5.04 s')).toBeCloseTo(5.04);
		expect(parseDurationSeconds('2.27 s')).toBeCloseTo(2.27);
	});
	it('returns null for empty or nonsense', () => {
		expect(parseDurationSeconds(undefined)).toBeNull();
		expect(parseDurationSeconds('')).toBeNull();
		expect(parseDurationSeconds('soon')).toBeNull();
	});
});

describe('probeVideoTags', () => {
	// Shape exiftool-vendored returns for a Pixel 10 Pro clip and a Premiere export.
	const pixel = { Duration: 1.2309, VideoFrameRate: 30.06, ImageWidth: 3840, ImageHeight: 2160, CompressorID: 'hvc1', AudioFormat: 'mp4a', MajorBrand: 'MP4 v2 [ISO 14496-14]', CreateDate: { toISOString: () => '2026-11-02T18:01:09.000Z' } };
	const premiere = { Duration: '0:00:40', VideoFrameRate: 29.97003, ImageWidth: 1920, ImageHeight: 1080, CompressorID: 'avc1', AudioFormat: 'mp4a', MajorBrand: 'MP4 v2 [ISO 14496-14]', CreateDate: '2026:11:03 09:48:40+01:00' };

	it('normalises a capture clip', () => {
		const v = probeVideoTags(pixel);
		expect(v.durationSeconds).toBeCloseTo(1.2309);
		expect(v.frameRate).toBeCloseTo(30.06);
		expect(v.width).toBe(3840);
		expect(v.height).toBe(2160);
		expect(v.container).toBe('mp4');
		expect(v.videoCodec).toBe('hvc1');
		expect(v.audioCodec).toBe('mp4a');
		expect(v.createdAt).toBe('2026-11-02T18:01:09.000Z');
	});

	it('normalises an NLE export with a clock-string duration', () => {
		const v = probeVideoTags(premiere);
		expect(v.durationSeconds).toBe(40);
		expect(v.videoCodec).toBe('avc1');
		expect(v.createdAt).toBe('2026:11:03 09:48:40+01:00');
	});

	it('handles audio-only files and missing tags', () => {
		const v = probeVideoTags({ Duration: '5.00 s', FileType: 'WAV', SampleRate: 48000, Encoding: 'Microsoft PCM' });
		expect(v.durationSeconds).toBe(5);
		expect(v.frameRate).toBeNull();
		expect(v.width).toBe(0);
		expect(v.container).toBe('wav');
		expect(v.audioCodec).toBe('Microsoft PCM');
		expect(probeVideoTags(null).durationSeconds).toBeNull();
	});
});
