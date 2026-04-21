import { describe, it, expect } from 'vitest';
import * as firefly from '../../../src/server/lib/extraction/parsers/firefly.js';

describe('firefly parser', () => {
	describe('detect()', () => {
		it('matches Claim_generator = Adobe_Firefly', () => {
			expect(firefly.detect({ Claim_generator: 'Adobe_Firefly' }, {})).toBe(true);
		});

		it('matches Claim_generator_info.name = Adobe_Firefly', () => {
			expect(firefly.detect({ Claim_generator_info: { name: 'Adobe_Firefly' } }, {})).toBe(true);
		});

		it('matches Actions object with softwareAgent = Adobe Firefly (image shape)', () => {
			expect(firefly.detect({ Actions: { softwareAgent: 'Adobe Firefly' } }, {})).toBe(true);
		});

		it('matches Actions array with Adobe Firefly entry (video shape)', () => {
			const actions = [
				{ action: 'c2pa.created' },
				{ action: 'c2pa.edited', softwareAgent: 'Adobe Firefly' }
			];
			expect(firefly.detect({ Actions: actions }, {})).toBe(true);
		});

		it('does not match arbitrary EXIF', () => {
			expect(firefly.detect({ Software: 'Adobe Photoshop' }, {})).toBe(false);
			expect(firefly.detect({ Claim_generator: 'c2pa-rs' }, {})).toBe(false);
			expect(firefly.detect({}, {})).toBe(false);
			expect(firefly.detect(null, null)).toBeFalsy();
		});
	});

	describe('parse()', () => {
		it('extracts firefly version + operation from image shape', () => {
			const exif = {
				Claim_generator: 'Adobe_Firefly',
				Actions: {
					action: 'c2pa.created',
					softwareAgent: 'Adobe Firefly',
					parameters: {
						'com.adobe.firefly.operation': 'text_to_image',
						'com.adobe.firefly.version': 'image5-release_restricted-firefly_v5-main_107429.129362'
					},
					digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
				},
				ImageWidth: 896,
				ImageHeight: 1152
			};
			const result = firefly.parse(exif, {});
			expect(result.platform).toBe('firefly');
			expect(result.modelName).toBe('Adobe Firefly');
			expect(result.modelVersion).toContain('firefly_v5');
			expect(result.otherParams.operation).toBe('text_to_image');
			expect(result.otherParams.c2paAction).toBe('c2pa.created');
			expect(result.otherParams.digitalSourceType).toContain('trainedAlgorithmicMedia');
			expect(result.width).toBe(896);
			expect(result.height).toBe(1152);
			expect(result.aspectRatio).toBe('7:9');
		});

		it('extracts firefly data from video (Actions array)', () => {
			const exif = {
				Claim_generator: 'Adobe_Firefly',
				Actions: [
					{ action: 'c2pa.created', digitalSourceType: 'http://c2pa.org/digitalsourcetype/empty' },
					{ action: 'c2pa.edited', softwareAgent: 'Adobe Firefly', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia' }
				],
				ImageWidth: 960,
				ImageHeight: 540
			};
			const result = firefly.parse(exif, {});
			expect(result.platform).toBe('firefly');
			expect(result.otherParams.c2paAction).toBe('c2pa.edited');
			expect(result.otherParams.digitalSourceType).toContain('compositeWithTrainedAlgorithmicMedia');
			expect(result.width).toBe(960);
			expect(result.aspectRatio).toBe('16:9');
		});

		it('returns safe defaults when only claim generator is present', () => {
			const result = firefly.parse({ Claim_generator: 'Adobe_Firefly' }, {});
			expect(result.platform).toBe('firefly');
			expect(result.modelName).toBe('Adobe Firefly');
			expect(result.modelVersion).toBe('');
			expect(result.width).toBe(0);
		});
	});
});
