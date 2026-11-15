// Pure tests for the video thumbnail helpers (no ffmpeg is run).
import { describe, it, expect } from 'vitest';
import { thumbnailKey, frameTime, frameArgs, durationArgs, THUMB_WIDTH } from '../../../src/server/lib/core/thumbnail.js';

describe('thumbnailKey', () => {
	const stat = { size: 1000, mtimeMs: 1731600000000.4 };

	it('is stable for the same file version and ends in .webp', () => {
		const a = thumbnailKey('P:/media/clip.mp4', stat);
		expect(a).toBe(thumbnailKey('P:/media/clip.mp4', stat));
		expect(a).toMatch(/^[0-9a-f]{32}\.webp$/);
	});

	it('treats slash direction and letter case of the path as the same file', () => {
		expect(thumbnailKey('P:\\Media\\Clip.mp4', stat)).toBe(thumbnailKey('p:/media/clip.mp4', stat));
	});

	it('changes when the file is replaced or the width changes', () => {
		const base = thumbnailKey('P:/media/clip.mp4', stat);
		expect(thumbnailKey('P:/media/clip.mp4', { ...stat, size: 1001 })).not.toBe(base);
		expect(thumbnailKey('P:/media/clip.mp4', { ...stat, mtimeMs: stat.mtimeMs + 5000 })).not.toBe(base);
		expect(thumbnailKey('P:/media/clip.mp4', stat, 240)).not.toBe(base);
	});
});

describe('frameTime', () => {
	it('takes a third of the way in', () => {
		expect(frameTime(19)).toBe(6.33);
		expect(frameTime('272.823933')).toBe(90.94);
	});

	it('falls back to the first frame when the duration is unknown', () => {
		for (const d of [undefined, null, '', 'N/A', 0, -3, NaN]) expect(frameTime(d)).toBe(0);
	});
});

describe('frameArgs', () => {
	it('seeks before the input and writes one scaled WebP frame', () => {
		const args = frameArgs({ input: 'in.mov', output: 'out.webp', at: 3.33 });
		expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
		expect(args).toEqual(expect.arrayContaining(['-frames:v', '1', 'libwebp', `scale=${THUMB_WIDTH}:-2`]));
		expect(args.at(-1)).toBe('out.webp');
	});

	it('leaves out the seek at zero', () => {
		expect(frameArgs({ input: 'in.mp4', output: 'o.webp' })).not.toContain('-ss');
	});
});

describe('durationArgs', () => {
	it('asks ffprobe for the container duration only', () => {
		expect(durationArgs('in.mp4')).toEqual(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'in.mp4']);
	});
});
