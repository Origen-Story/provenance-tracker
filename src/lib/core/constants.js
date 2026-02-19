export const ASSET_TYPES = [
	{ value: 'character', label: 'Character', abbr: 'CHAR' },
	{ value: 'environment', label: 'Environment', abbr: 'ENV' },
	{ value: 'animation', label: 'Animation', abbr: 'ANIM' },
	{ value: 'audio', label: 'Audio', abbr: 'AUD' },
	{ value: 'video', label: 'Video', abbr: 'VID' },
	{ value: 'other', label: 'Other', abbr: 'OTH' }
];

export const PLATFORMS = [
	{ value: 'midjourney', label: 'MidJourney', color: 'midjourney' },
	{ value: 'meta-ai', label: 'Meta AI', color: 'meta-ai' },
	{ value: 'comfyui', label: 'ComfyUI', color: 'comfyui' },
	{ value: 'freepik', label: 'Freepik', color: 'freepik' },
	{ value: 'nanobanana', label: 'Nano Banana', color: 'accent' },
	{ value: 'premiere', label: 'Adobe Premiere Pro', color: 'accent' },
	{ value: 'manual', label: 'Manual Entry', color: 'text-secondary' },
	{ value: 'unknown', label: 'Unknown', color: 'text-secondary' }
];

export const DIGITAL_SOURCE_TYPES = [
	{
		value: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
		label: 'Trained Algorithmic Media (AI-generated)',
		short: 'trainedAlgorithmicMedia'
	},
	{
		value: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
		label: 'Composite with Trained Algorithmic Media',
		short: 'compositeWithTrainedAlgorithmicMedia'
	},
	{
		value: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeSynthetic',
		label: 'Composite Synthetic',
		short: 'compositeSynthetic'
	},
	{
		value: 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia',
		label: 'Algorithmic Media (non-AI)',
		short: 'algorithmicMedia'
	},
	{
		value: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
		label: 'Digital Capture',
		short: 'digitalCapture'
	}
];

export const RELATIONSHIP_TYPES = [
	{ value: 'ingredient', label: 'Ingredient (source asset)' },
	{ value: 'variation', label: 'Variation' },
	{ value: 'upscale', label: 'Upscale' }
];

export const COMPLETENESS_FIELDS = {
	description: 15,
	prompt: 15,
	digitalSourceType: 15,
	assetType: 10,
	modelName: 10,
	generationDate: 10,
	platform: 5,
	seed: 5,
	dimensions: 5,
	generationParams: 5,
	notes: 5
};
