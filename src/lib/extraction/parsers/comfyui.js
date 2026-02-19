/**
 * Parse ComfyUI metadata from PNG text chunks.
 *
 * ComfyUI embeds two JSON structures:
 *   - 'prompt': the execution graph (nodes that ran)
 *   - 'workflow': the full UI workflow (all nodes including inactive)
 *
 * We parse the 'prompt' graph to extract:
 *   - KSampler / KSamplerAdvanced → seed, steps, cfg, sampler, scheduler
 *   - CLIPTextEncode → positive/negative prompts (traced from KSampler refs)
 *   - CheckpointLoaderSimple / UNETLoader → model name
 *   - CLIPLoader → clip model name
 *   - LoraLoader → lora names + weights
 *   - EmptyLatentImage → width, height
 *   - ControlNet nodes → controlnet model names
 *
 * @param {{ exif: object|null, pngText: Record<string,string>|null, c2pa: object|null }} raw
 * @returns {{ parsed: object, gaps: string[] }}
 */
export function parseComfyuiMetadata(raw) {
	const { pngText } = raw;

	if (!pngText?.prompt) {
		return {
			parsed: { platform: 'comfyui' },
			gaps: ['prompt', 'modelName', 'seed', 'steps', 'description', 'assetType', 'generationDate']
		};
	}

	let graph;
	try {
		graph = JSON.parse(pngText.prompt);
	} catch {
		return {
			parsed: { platform: 'comfyui' },
			gaps: ['prompt', 'modelName', 'seed', 'steps', 'description', 'assetType', 'generationDate']
		};
	}

	const nodes = Object.entries(graph);

	// Find sampler node
	const sampler = findNodeByType(nodes, ['KSampler', 'KSamplerAdvanced']);
	// Find model loaders
	const checkpoint = findNodeByType(nodes, ['CheckpointLoaderSimple', 'CheckpointLoader']);
	const unetLoader = findNodeByType(nodes, ['UNETLoader']);
	const clipLoader = findNodeByType(nodes, ['CLIPLoader', 'DualCLIPLoader']);
	const vaeLoader = findNodeByType(nodes, ['VAELoader']);
	// Find dimensions
	const latentImage = findNodeByType(nodes, ['EmptyLatentImage']);
	// Find LoRAs
	const loras = findAllNodesByType(nodes, ['LoraLoader', 'LoraLoaderModelOnly']);
	// Find ControlNets
	const controlnets = findAllNodesByType(nodes, [
		'ControlNetLoader',
		'ControlNetApply',
		'ControlNetApplyAdvanced',
		'ModelPatchLoader'
	]);

	const parsed = {
		platform: 'comfyui',
		modelName: '',
		seed: '',
		steps: 0,
		cfgScale: '',
		sampler: '',
		scheduler: '',
		prompt: '',
		negativePrompt: '',
		width: 0,
		height: 0,
		loras: [],
		controlnets: [],
		otherParams: {}
	};

	// Extract sampler params
	if (sampler) {
		const inputs = sampler.node.inputs;
		parsed.seed = String(inputs.seed ?? '');
		parsed.steps = inputs.steps ?? 0;
		parsed.cfgScale = String(inputs.cfg ?? '');
		parsed.sampler = inputs.sampler_name ?? '';
		parsed.scheduler = inputs.scheduler ?? '';

		// Trace positive prompt
		if (Array.isArray(inputs.positive)) {
			const posNode = graph[inputs.positive[0]];
			if (posNode?.inputs?.text) {
				parsed.prompt = posNode.inputs.text;
			}
		}

		// Trace negative prompt
		if (Array.isArray(inputs.negative)) {
			const negNode = graph[inputs.negative[0]];
			if (negNode?.inputs?.text) {
				parsed.negativePrompt = negNode.inputs.text;
			}
		}
	}

	// Extract model name
	if (checkpoint) {
		parsed.modelName = checkpoint.node.inputs.ckpt_name ?? '';
	} else if (unetLoader) {
		parsed.modelName = unetLoader.node.inputs.unet_name ?? '';
	}

	// Store CLIP and VAE info
	if (clipLoader) {
		parsed.otherParams.clipModel = clipLoader.node.inputs.clip_name ?? '';
	}
	if (vaeLoader) {
		parsed.otherParams.vaeModel = vaeLoader.node.inputs.vae_name ?? '';
	}

	// Extract dimensions
	if (latentImage) {
		parsed.width = latentImage.node.inputs.width ?? 0;
		parsed.height = latentImage.node.inputs.height ?? 0;
	}

	// Extract LoRA info
	for (const lora of loras) {
		parsed.loras.push({
			name: lora.node.inputs.lora_name ?? '',
			weight: lora.node.inputs.strength_model ?? 1.0
		});
	}

	// Extract ControlNet info
	for (const cn of controlnets) {
		const name =
			cn.node.inputs.control_net_name ??
			cn.node.inputs.name ??
			cn.node.inputs.model_name ??
			'';
		if (name) {
			parsed.controlnets.push({
				name,
				strength: cn.node.inputs.strength ?? cn.node.inputs.strength_percent ?? 1.0
			});
		}
	}

	const gaps = ['description', 'assetType', 'generationDate', 'digitalSourceType'];
	if (!parsed.prompt) gaps.unshift('prompt');

	return { parsed, gaps };
}

function findNodeByType(nodes, types) {
	for (const [id, node] of nodes) {
		if (types.includes(node.class_type)) {
			return { id, node };
		}
	}
	return null;
}

function findAllNodesByType(nodes, types) {
	return nodes
		.filter(([, node]) => types.includes(node.class_type))
		.map(([id, node]) => ({ id, node }));
}
