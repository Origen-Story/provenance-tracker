import path from 'path';
import { extractExif } from './exif.js';
import { extractC2pa } from './c2pa.js';
import { extractPngChunks } from './png-chunks.js';
import { isFreepik, parseFreepik } from './parsers/freepik.js';
import { isComfyUI, parseComfyUI } from './parsers/comfyui.js';
import { isMidjourney, parseMidjourney } from './parsers/midjourney.js';
import { computeFileHash, getMimeType, getFileSize } from '../core/file-utils.js';

/**
 * Detect platform from EXIF tags and PNG chunks.
 */
function detectPlatform(exifTags, chunks) {
	if (isComfyUI(exifTags, chunks)) return 'comfyui';
	if (isMidjourney(exifTags, chunks)) return 'midjourney';
	if (isFreepik(exifTags, chunks)) return 'freepik';
	return 'unknown';
}

/**
 * Run the platform-specific parser.
 */
function parsePlatform(platform, exifTags, chunks) {
	if (platform === 'freepik') return parseFreepik(exifTags, chunks);
	if (platform === 'comfyui') return parseComfyUI(exifTags, chunks);
	if (platform === 'midjourney') return parseMidjourney(exifTags, chunks);

	// Generic fallback
	return {
		platform: 'unknown',
		prompt: exifTags?.Description || exifTags?.ImageDescription || '',
		negativePrompt: '',
		modelName: exifTags?.Software || '',
		modelVersion: '',
		seed: '',
		width: exifTags?.ImageWidth || exifTags?.ExifImageWidth || 0,
		height: exifTags?.ImageHeight || exifTags?.ExifImageHeight || 0,
		otherParams: {}
	};
}

/**
 * Determine asset type from MIME type.
 */
function getAssetType(mimeType) {
	if (mimeType.startsWith('image/')) return 'image';
	if (mimeType.startsWith('video/')) return 'video';
	if (mimeType.startsWith('audio/')) return 'audio';
	return 'other';
}

/**
 * Full extraction pipeline for an AI asset file.
 * Returns everything needed to populate the import form.
 */
export async function extractAIAsset(filePath) {
	const [exifTags, c2paManifest, pngChunks, fileHash, fileSize] = await Promise.all([
		extractExif(filePath),
		extractC2pa(filePath),
		extractPngChunks(filePath),
		computeFileHash(filePath),
		getFileSize(filePath)
	]);

	const mimeType = getMimeType(filePath);
	const filename = path.basename(filePath);
	const assetType = getAssetType(mimeType);

	const platform = detectPlatform(exifTags, pngChunks);
	const platformData = parsePlatform(platform, exifTags, pngChunks);

	// Build clean EXIF summary (exclude noise)
	const skipKeys = new Set(['SourceFile', 'ExifToolVersion', 'FileInodeChangeDate', 'FilePermissions']);
	const exifSummary = {};
	if (exifTags) {
		for (const [k, v] of Object.entries(exifTags)) {
			if (!skipKeys.has(k) && typeof v !== 'object') exifSummary[k] = v;
		}
	}

	// Detect generation date
	const generationDate =
		exifTags?.DateTimeOriginal?.toString()?.slice(0, 10) ||
		exifTags?.CreateDate?.toString()?.slice(0, 10) ||
		exifTags?.ModifyDate?.toString()?.slice(0, 10) ||
		'';

	return {
		filePath,
		filename,
		fileHash,
		fileSize,
		mimeType,
		assetType,
		platform,
		generationDate,
		// Platform-parsed fields (pre-fill the form)
		suggestedPrompt: platformData.prompt || '',
		suggestedNegativePrompt: platformData.negativePrompt || '',
		suggestedModel: platformData.modelName || '',
		suggestedModelVersion: platformData.modelVersion || '',
		suggestedSeed: platformData.seed || '',
		suggestedSteps: platformData.steps || 0,
		suggestedCfgScale: platformData.cfgScale || '',
		suggestedSampler: platformData.sampler || '',
		suggestedScheduler: platformData.scheduler || '',
		suggestedWidth: platformData.width || 0,
		suggestedHeight: platformData.height || 0,
		suggestedAspectRatio: platformData.aspectRatio || '',
		suggestedStylize: platformData.stylize || '',
		// Raw data for storage
		exifJson: JSON.stringify(exifSummary),
		c2paJson: c2paManifest ? JSON.stringify(c2paManifest) : null,
		pngChunksJson: Object.keys(pngChunks).length ? JSON.stringify(pngChunks) : null,
		platformJson: JSON.stringify({ platform, ...platformData })
	};
}
