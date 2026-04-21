/**
 * Parse ComfyUI PNG metadata.
 * ComfyUI stores workflow and prompt as JSON in PNG tEXt chunks.
 */

export const id = 'comfyui';

// Fields we expect to populate from a well-formed ComfyUI workflow.
// Used by the dispatcher to compute extraction coverage — a low score flags
// the asset for review (parser may be stale vs current ComfyUI output).
export const coreFields = ['prompt', 'seed', 'modelName', 'sampler'];

export function detect(exifTags, chunks) {
	return !!(chunks?.prompt || chunks?.workflow);
}

export function parse(exifTags, chunks) {
	const result = {
		platform: 'comfyui',
		prompt: '',
		negativePrompt: '',
		modelName: '',
		modelVersion: '',
		seed: '',
		steps: 0,
		cfgScale: '',
		sampler: '',
		scheduler: '',
		width: 0,
		height: 0,
		otherParams: {}
	};

	// ComfyUI stores the full prompt graph as JSON in the 'prompt' chunk
	const promptChunk = chunks?.prompt || chunks?.Prompt || '';
	if (promptChunk) {
		try {
			const graph = JSON.parse(promptChunk);
			result.otherParams.comfyWorkflow = graph;

			// Walk nodes to find useful values
			for (const node of Object.values(graph)) {
				const inputs = node?.inputs || {};
				const classType = node?.class_type || '';

				if (classType === 'CLIPTextEncode' || classType.includes('Prompt')) {
					if (inputs.text && !result.prompt) result.prompt = inputs.text;
				}
				if (classType === 'KSampler' || classType === 'KSamplerAdvanced') {
					if (inputs.seed) result.seed = String(inputs.seed);
					if (inputs.steps) result.steps = inputs.steps;
					if (inputs.cfg) result.cfgScale = String(inputs.cfg);
					if (inputs.sampler_name) result.sampler = inputs.sampler_name;
					if (inputs.scheduler) result.scheduler = inputs.scheduler;
				}
				if (classType === 'CheckpointLoaderSimple' || classType.includes('Checkpoint')) {
					if (inputs.ckpt_name && !result.modelName) result.modelName = inputs.ckpt_name;
				}
				if (classType === 'EmptyLatentImage') {
					if (inputs.width) result.width = inputs.width;
					if (inputs.height) result.height = inputs.height;
				}
			}
		} catch {
			// Not valid JSON
		}
	}

	// Also check the 'workflow' chunk
	const workflowChunk = chunks?.workflow || '';
	if (workflowChunk && !result.otherParams.comfyWorkflow) {
		try {
			result.otherParams.comfyWorkflow = JSON.parse(workflowChunk);
		} catch { /* ignore */ }
	}

	// Fall back to EXIF dimensions
	if (!result.width) result.width = exifTags?.ImageWidth || exifTags?.ExifImageWidth || 0;
	if (!result.height) result.height = exifTags?.ImageHeight || exifTags?.ExifImageHeight || 0;

	return result;
}

