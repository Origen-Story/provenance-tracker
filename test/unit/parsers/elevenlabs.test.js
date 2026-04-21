import { describe, it, expect } from 'vitest';
import * as elevenlabs from '../../../src/server/lib/extraction/parsers/elevenlabs.js';

describe('elevenlabs parser', () => {
	describe('detect()', () => {
		it('matches C2PA Actions.softwareAgent', () => {
			expect(elevenlabs.detect({ Actions: { softwareAgent: 'ElevenLabs' } }, {})).toBe(true);
		});

		it('matches Author.name = Eleven Labs Inc.', () => {
			expect(elevenlabs.detect({ Author: { name: 'Eleven Labs Inc.' } }, {})).toBe(true);
		});

		it('matches filename prefix on audio file', () => {
			expect(elevenlabs.detect({ FileName: 'ElevenLabs_2025-10-21T10_10_22__s50_v3.mp3' }, {})).toBe(true);
		});

		it('matches filename suffix on audio file', () => {
			expect(elevenlabs.detect({ FileName: 'AMBUrbn-Urban_outdoor-Elevenlabs.wav' }, {})).toBe(true);
		});

		it('does not match filename if not audio extension', () => {
			expect(elevenlabs.detect({ FileName: 'ElevenLabs_snapshot.png' }, {})).toBe(false);
		});

		it('does not match arbitrary audio file', () => {
			expect(elevenlabs.detect({ FileName: 'Velvet_Nightdrive.wav' }, {})).toBe(false);
			expect(elevenlabs.detect({}, {})).toBe(false);
			expect(elevenlabs.detect(null, null)).toBeFalsy();
		});
	});

	describe('parse()', () => {
		it('extracts C2PA action and author', () => {
			const exif = {
				Actions: {
					action: 'c2pa.created',
					softwareAgent: 'ElevenLabs',
					digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
				},
				Author: { name: 'Eleven Labs Inc.' },
				Duration: 1.72
			};
			const result = elevenlabs.parse(exif, {});
			expect(result.platform).toBe('elevenlabs');
			expect(result.modelName).toBe('ElevenLabs');
			expect(result.otherParams.c2paAction).toBe('c2pa.created');
			expect(result.otherParams.author).toBe('Eleven Labs Inc.');
			expect(result.otherParams.duration).toBe(1.72);
			expect(result.otherParams.detectionSource).toBeUndefined();
		});

		it('flags filename-only matches with detectionSource', () => {
			const exif = { FileName: 'ElevenLabs_2025-10-24T08_25_24.wav' };
			const result = elevenlabs.parse(exif, {});
			expect(result.platform).toBe('elevenlabs');
			expect(result.otherParams.detectionSource).toBe('filename');
		});

		it('returns safe defaults on empty input', () => {
			const result = elevenlabs.parse({}, {});
			expect(result.platform).toBe('elevenlabs');
			expect(result.modelName).toBe('ElevenLabs');
		});
	});
});
