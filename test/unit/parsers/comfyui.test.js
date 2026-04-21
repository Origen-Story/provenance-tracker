import { describe, it, expect } from 'vitest';
import * as comfyui from '../../../src/server/lib/extraction/parsers/comfyui.js';

describe('comfyui parser', () => {
	describe('detect()', () => {
		it('matches when prompt or workflow chunk present', () => {
			expect(comfyui.detect({}, { prompt: '{}' })).toBe(true);
			expect(comfyui.detect({}, { workflow: '{}' })).toBe(true);
		});

		it('does not match without PNG chunks', () => {
			expect(comfyui.detect({ Software: 'ComfyUI' }, {})).toBe(false);
			expect(comfyui.detect({}, {})).toBe(false);
		});
	});

	describe('parse()', () => {
		it('extracts prompt, sampler params, and model from workflow JSON', () => {
			const graph = {
				'1': {
					class_type: 'CLIPTextEncode',
					inputs: { text: 'a mountain vista, cinematic lighting' }
				},
				'2': {
					class_type: 'KSampler',
					inputs: {
						seed: 42,
						steps: 20,
						cfg: 7.5,
						sampler_name: 'euler',
						scheduler: 'karras'
					}
				},
				'3': {
					class_type: 'CheckpointLoaderSimple',
					inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' }
				},
				'4': {
					class_type: 'EmptyLatentImage',
					inputs: { width: 1024, height: 1024 }
				}
			};
			const result = comfyui.parse({}, { prompt: JSON.stringify(graph) });
			expect(result.platform).toBe('comfyui');
			expect(result.prompt).toBe('a mountain vista, cinematic lighting');
			expect(result.seed).toBe('42');
			expect(result.steps).toBe(20);
			expect(result.cfgScale).toBe('7.5');
			expect(result.sampler).toBe('euler');
			expect(result.scheduler).toBe('karras');
			expect(result.modelName).toBe('sd_xl_base_1.0.safetensors');
			expect(result.width).toBe(1024);
			expect(result.height).toBe(1024);
		});

		it('tolerates malformed JSON without throwing', () => {
			const result = comfyui.parse({}, { prompt: 'not json at all {' });
			expect(result.platform).toBe('comfyui');
			expect(result.prompt).toBe('');
		});

		it('falls back to EXIF dimensions when workflow lacks EmptyLatentImage', () => {
			const result = comfyui.parse(
				{ ImageWidth: 512, ImageHeight: 768 },
				{ prompt: '{}' }
			);
			expect(result.width).toBe(512);
			expect(result.height).toBe(768);
		});
	});
});
