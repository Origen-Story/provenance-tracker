import { describe, it, expect } from 'vitest';
import * as gigapixel from '../../../src/server/lib/extraction/parsers/topaz-gigapixel.js';
import { detectAndParse } from '../../../src/server/lib/extraction/ai-extraction.js';

// Tags as exiftool returns them for a Gigapixel output (real file, name shortened).
const TAGS = {
	FileName: 'street-scene__86475-gigapixel-redefine-realistic-2x-faceai v2.png',
	Software: 'Topaz Gigapixel 1.1.2 (Windows)',
	CreatorTool: 'Topaz Gigapixel 1.1.2 (Windows)',
	HistorySoftwareAgent: 'Topaz Gigapixel 1.1.2 (Windows)',
	DigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
	Credit: 'Made with Google AI',
	ImageWidth: 5504,
	ImageHeight: 3072
};

describe('topaz-gigapixel parser', () => {
	it('detects on the Software / CreatorTool string', () => {
		expect(gigapixel.detect(TAGS)).toBe(true);
		expect(gigapixel.detect({ Software: 'Adobe Photoshop' })).toBe(false);
		expect(gigapixel.detect(null)).toBe(false);
	});

	it('parses model, scale and app version, and marks itself a modifier', () => {
		const r = gigapixel.parse(TAGS);
		expect(r.platform).toBe('topaz-gigapixel');
		expect(r.modelName).toBe('Topaz Gigapixel');
		expect(r.otherParams.assetClass).toBe('modifier');
		expect(r.otherParams.model).toBe('redefine-realistic');
		expect(r.otherParams.scale).toBe('2x');
		expect(r.otherParams.appVersion).toBe('1.1.2');
		expect(r.width).toBe(5504);
	});

	it('is reached through the registry ahead of the fuzzier parsers', () => {
		const { platform, coverage } = detectAndParse(TAGS, {});
		expect(platform).toBe('topaz-gigapixel');
		expect(coverage).toBe(100);
	});
});
