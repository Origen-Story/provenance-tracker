import { describe, it, expect } from 'vitest';
import * as freepik from '../../../src/server/lib/extraction/parsers/freepik.js';

describe('freepik parser', () => {
	describe('detect()', () => {
		it.each([
			[{ Creator: 'Freepik Company' }],
			[{ Creator: 'Pikaso AI' }],
			[{ Software: 'Freepik Mystic' }],
			[{ Copyright: 'Freepik' }],
			[{ 'XMP:Creator': 'Freepik' }]
		])('matches %o', (tags) => {
			expect(freepik.detect(tags, {})).toBe(true);
		});

		it('does not match arbitrary EXIF', () => {
			expect(freepik.detect({ Creator: 'Jane Photographer' }, {})).toBe(false);
			expect(freepik.detect({}, {})).toBe(false);
		});
	});

	describe('parse()', () => {
		it('extracts prompt and dimensions, computes aspect ratio', () => {
			const exif = {
				'XMP:Description': 'a serene mountain lake',
				Software: 'Freepik Mystic',
				ImageWidth: 1920,
				ImageHeight: 1080
			};
			const result = freepik.parse(exif, {});
			expect(result.platform).toBe('freepik');
			expect(result.prompt).toBe('a serene mountain lake');
			expect(result.aspectRatio).toBe('16:9');
		});

		it('falls back across description fields', () => {
			expect(freepik.parse({ ImageDescription: 'from image description' }, {}).prompt)
				.toBe('from image description');
		});

		it('defaults model name to Freepik AI when no tag', () => {
			expect(freepik.parse({}, {}).modelName).toBe('Freepik AI');
		});
	});
});
