import { describe, it, expect } from 'vitest';
import { parsers } from '../../../src/server/lib/extraction/parsers/index.js';

describe('parser registry', () => {
	it('every parser exports id, detect, parse', () => {
		for (const p of parsers) {
			expect(typeof p.id).toBe('string');
			expect(typeof p.detect).toBe('function');
			expect(typeof p.parse).toBe('function');
		}
	});

	it('parser ids are unique', () => {
		const ids = parsers.map(p => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('detect() returns false on empty input for every parser', () => {
		for (const p of parsers) {
			expect(p.detect({}, {})).toBe(false);
			expect(p.detect(null, null)).toBeFalsy();
		}
	});
});
