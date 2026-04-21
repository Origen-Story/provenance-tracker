import path from 'path';
import { extractExif } from './exif.js';
import { extractC2pa } from './c2pa.js';
import { extractPngChunks } from './png-chunks.js';
import { parsers } from './parsers/index.js';
import { computeFileHash, getMimeType, getFileSize } from '../core/file-utils.js';

// Walk the registered parsers in priority order; first detect() match wins.
// Falls back to a generic EXIF-only shape so callers always get the same fields.
//
// Returns `coverage` as a 0–100 integer reflecting how many of the parser's
// declared `coreFields` got populated. Low coverage on a recognized platform
// usually means the source format drifted and the parser needs updating —
// novelty detection uses this plus `platform === 'unknown'` to flag for review.
//
// Exported so re-extraction can replay it against stored raw metadata without
// re-reading the file from disk — the key property that lets parser updates
// flow back to previously-imported assets.
export function detectAndParse(exifTags, chunks) {
	for (const p of parsers) {
		if (p.detect(exifTags, chunks)) {
			const data = p.parse(exifTags, chunks);
			return { platform: p.id, coverage: computeCoverage(p, data), data };
		}
	}
	return {
		platform: 'unknown',
		coverage: 0,
		data: {
			platform: 'unknown',
			prompt: exifTags?.Description || exifTags?.ImageDescription || '',
			negativePrompt: '',
			modelName: exifTags?.Software || '',
			modelVersion: '',
			seed: '',
			width: exifTags?.ImageWidth || exifTags?.ExifImageWidth || 0,
			height: exifTags?.ImageHeight || exifTags?.ExifImageHeight || 0,
			otherParams: {}
		}
	};
}

function computeCoverage(parser, data) {
	const fields = parser.coreFields || [];
	if (fields.length === 0) return 100;
	const populated = fields.filter(f => {
		const v = data?.[f];
		return v !== undefined && v !== null && v !== '' && v !== 0;
	}).length;
	return Math.round((populated / fields.length) * 100);
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

	const { platform, coverage, data: platformData } = detectAndParse(exifTags, pngChunks);

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
		extractionCoverage: coverage,
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
