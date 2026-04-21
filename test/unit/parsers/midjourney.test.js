import { describe, it, expect } from 'vitest';
import * as midjourney from '../../../src/server/lib/extraction/parsers/midjourney.js';

describe('midjourney parser', () => {
	describe('detect()', () => {
		it('matches Software tag containing midjourney', () => {
			expect(midjourney.detect({ Software: 'Midjourney v6' }, {})).toBe(true);
		});

		it('matches --v NN in description', () => {
			expect(midjourney.detect({ Description: 'a cat --v 6' }, {})).toBe(true);
		});

		it('matches --ar in description', () => {
			expect(midjourney.detect({ Description: 'a cat --ar 16:9' }, {})).toBe(true);
		});

		it('does not match arbitrary EXIF', () => {
			expect(midjourney.detect({ Software: 'Adobe Photoshop' }, {})).toBe(false);
			expect(midjourney.detect({}, {})).toBe(false);
		});
	});

	describe('parse()', () => {
		it('extracts prompt, version, seed, aspect ratio, stylize', () => {
			const exif = {
				Description: 'a majestic lion under the sun --v 6.1 --ar 16:9 --seed 123456 --stylize 250',
				ImageWidth: 1920,
				ImageHeight: 1080
			};
			const result = midjourney.parse(exif, {});
			expect(result.platform).toBe('midjourney');
			expect(result.prompt).toBe('a majestic lion under the sun');
			expect(result.modelVersion).toBe('v6.1');
			expect(result.seed).toBe('123456');
			expect(result.aspectRatio).toBe('16:9');
			expect(result.stylize).toBe('250');
			expect(result.width).toBe(1920);
			expect(result.height).toBe(1080);
		});

		it('handles prompt with no params', () => {
			const result = midjourney.parse({ Description: 'just a prompt' }, {});
			expect(result.prompt).toBe('just a prompt');
			expect(result.modelVersion).toBe('');
			expect(result.seed).toBe('');
		});

		it('returns empty fields on empty input', () => {
			const result = midjourney.parse({}, {});
			expect(result.platform).toBe('midjourney');
			expect(result.prompt).toBe('');
			expect(result.modelName).toBe('Midjourney');
		});
	});
});
