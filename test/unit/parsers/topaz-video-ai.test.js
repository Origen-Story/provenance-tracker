import { describe, it, expect } from 'vitest';
import * as topaz from '../../../src/server/lib/extraction/parsers/topaz-video-ai.js';

const SAMPLE_TAG = 'Enhanced using prob-4; mode: auto; revert compression at 0; recover details at 0; sharpen at 0; reduce noise at 0; dehalo at 0; anti-alias/deblur at 0; focus fix Off; and recover original detail at 20. Changed resolution to 3840x2160';

describe('topaz-video-ai parser', () => {
	describe('detect()', () => {
		it('matches Videoai tag containing "Enhanced using"', () => {
			expect(topaz.detect({ Videoai: SAMPLE_TAG }, {})).toBe(true);
		});

		it('does not match arbitrary EXIF', () => {
			expect(topaz.detect({ Software: 'Adobe Premiere' }, {})).toBe(false);
			expect(topaz.detect({ Videoai: 'some other topaz output' }, {})).toBe(false);
			expect(topaz.detect({}, {})).toBe(false);
			expect(topaz.detect(null, null)).toBeFalsy();
		});
	});

	describe('parse()', () => {
		it('extracts model, mode, resolution, and settings', () => {
			const result = topaz.parse({ Videoai: SAMPLE_TAG }, {});
			expect(result.platform).toBe('topaz-video-ai');
			expect(result.modelName).toBe('Topaz Video AI');
			expect(result.modelVersion).toBe('prob-4');
			expect(result.otherParams.mode).toBe('auto');
			expect(result.width).toBe(3840);
			expect(result.height).toBe(2160);
			expect(result.otherParams.settings.sharpen).toBe(0);
			expect(result.otherParams.settings.recover_original_detail).toBe(20);
			expect(result.otherParams.assetClass).toBe('modifier');
			expect(result.otherParams.videoaiRaw).toBe(SAMPLE_TAG);
		});

		it('falls back to source dimensions when resolution clause is absent', () => {
			const result = topaz.parse({
				Videoai: 'Enhanced using iris-2; mode: manual',
				ImageWidth: 1920,
				ImageHeight: 1080
			}, {});
			expect(result.modelVersion).toBe('iris-2');
			expect(result.otherParams.mode).toBe('manual');
			expect(result.width).toBe(1920);
			expect(result.height).toBe(1080);
		});

		it('returns safe defaults on missing tag', () => {
			const result = topaz.parse({}, {});
			expect(result.platform).toBe('topaz-video-ai');
			expect(result.modelVersion).toBe('');
			expect(result.width).toBe(0);
		});
	});
});
