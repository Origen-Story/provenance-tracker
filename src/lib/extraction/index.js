import { extractExif } from './extractors/exif.js';
import { extractPngChunks } from './extractors/png-chunks.js';
import { extractC2pa } from './extractors/c2pa.js';
import { detectPlatform } from './parsers/platform-detect.js';
import { parseMidjourneyMetadata } from './parsers/midjourney.js';
import { parseMetaAiMetadata } from './parsers/meta-ai.js';
import { parseComfyuiMetadata } from './parsers/comfyui.js';
import { parseFreepikMetadata } from './parsers/freepik.js';
import {
	computeFileHash,
	getMimeType,
	getFileSize,
	isPng,
	normalizePath
} from '../core/utils/file-utils.js';
import { COMPLETENESS_FIELDS } from '../core/constants.js';

/**
 * Main metadata extraction orchestrator.
 * Runs all extractors, detects platform, parses metadata, calculates completeness.
 *
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<ExtractedResult>}
 */
export async function extractMetadata(filePath) {
	const normalizedPath = normalizePath(filePath);

	// File info
	const [fileHash, fileSize] = await Promise.all([
		computeFileHash(normalizedPath),
		getFileSize(normalizedPath)
	]);

	const mimeType = getMimeType(normalizedPath);

	// Run extractors in parallel
	const isPngFile = isPng(normalizedPath);

	const [exif, pngText, c2pa] = await Promise.all([
		extractExif(normalizedPath),
		isPngFile ? extractPngChunks(normalizedPath) : Promise.resolve(null),
		extractC2pa(normalizedPath)
	]);

	const rawMetadata = { exif, pngText, c2pa };

	// Detect platform
	const platform = detectPlatform(rawMetadata, normalizedPath);

	// Parse based on platform
	let parsed = {};
	let gaps = [];

	switch (platform) {
		case 'midjourney':
			({ parsed, gaps } = parseMidjourneyMetadata(rawMetadata));
			break;
		case 'meta-ai':
			({ parsed, gaps } = parseMetaAiMetadata(rawMetadata, normalizedPath));
			break;
		case 'comfyui':
			({ parsed, gaps } = parseComfyuiMetadata(rawMetadata));
			break;
		case 'freepik':
			({ parsed, gaps } = parseFreepikMetadata(rawMetadata, normalizedPath));
			break;
		default:
			gaps = [
				'prompt',
				'modelName',
				'seed',
				'description',
				'assetType',
				'generationDate',
				'digitalSourceType'
			];
	}

	// Add image dimensions from EXIF if not already parsed
	if (!parsed.width && exif?.ImageWidth) parsed.width = exif.ImageWidth;
	if (!parsed.height && exif?.ImageHeight) parsed.height = exif.ImageHeight;

	// Calculate completeness
	const completeness = calculateCompleteness(parsed);

	return {
		platform,
		fileInfo: {
			path: normalizedPath,
			hash: fileHash,
			size: fileSize,
			mimeType,
			width: parsed.width || 0,
			height: parsed.height || 0
		},
		rawMetadata,
		parsed,
		gaps,
		completeness
	};
}

/**
 * Calculate completeness score (0-100) based on which fields are populated.
 * @param {object} parsed
 * @returns {number}
 */
function calculateCompleteness(parsed) {
	let score = 0;
	const fields = COMPLETENESS_FIELDS;

	if (parsed.description) score += fields.description;
	if (parsed.prompt) score += fields.prompt;
	if (parsed.digitalSourceType) score += fields.digitalSourceType;
	if (parsed.assetType && parsed.assetType !== 'other') score += fields.assetType;
	if (parsed.modelName) score += fields.modelName;
	if (parsed.generationDate) score += fields.generationDate;
	if (parsed.platform && parsed.platform !== 'unknown') score += fields.platform;
	if (parsed.seed) score += fields.seed;
	if (parsed.width && parsed.height) score += fields.dimensions;
	if (parsed.steps || parsed.stylize || parsed.cfgScale) score += fields.generationParams;
	if (parsed.notes) score += fields.notes;

	return score;
}
