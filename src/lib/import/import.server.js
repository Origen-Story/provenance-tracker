import { readdirSync, statSync } from 'fs';
import path from 'path';
import { extractMetadata } from '../extraction/index.js';
import { isSupportedFile, normalizePath } from '../core/utils/file-utils.js';
import { generateAssetId } from '../core/utils/asset-id.js';
import { db } from '../core/db/index.js';
import { assets, assetMetadata, generationParams, projectConfig } from '../core/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Scan a path (file or directory) and extract metadata from all supported files.
 * @param {string} inputPath - Absolute path to a file or directory
 * @returns {Promise<Array>} Array of extraction results
 */
export async function scanAndExtract(inputPath) {
	const normalized = normalizePath(inputPath);
	const filePaths = [];

	try {
		const stats = statSync(normalized);
		if (stats.isDirectory()) {
			collectFiles(normalized, filePaths);
		} else if (stats.isFile() && isSupportedFile(normalized)) {
			filePaths.push(normalized);
		}
	} catch (err) {
		throw new Error(`Cannot access path: ${inputPath}`);
	}

	if (filePaths.length === 0) {
		return [];
	}

	const results = [];
	for (const fp of filePaths) {
		try {
			const result = await extractMetadata(fp);
			results.push(result);
		} catch (err) {
			results.push({
				platform: 'unknown',
				fileInfo: { path: fp, hash: '', size: 0, mimeType: '', width: 0, height: 0 },
				parsed: {},
				gaps: ['all'],
				completeness: 0,
				error: err.message
			});
		}
	}

	return results;
}

/**
 * Recursively collect supported files from a directory.
 */
function collectFiles(dirPath, results) {
	const entries = readdirSync(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = normalizePath(path.join(dirPath, entry.name));
		if (entry.isDirectory()) {
			collectFiles(fullPath, results);
		} else if (entry.isFile() && isSupportedFile(fullPath)) {
			results.push(fullPath);
		}
	}
}

/**
 * Persist a confirmed import to the database.
 * @param {object} extraction - The extraction result from scanAndExtract
 * @param {object} userEdits - User-provided overrides (description, assetType, etc.)
 * @returns {object} The created asset record
 */
export function confirmImport(extraction, userEdits) {
	const config = db.select().from(projectConfig).limit(1).get();
	const prefix = config?.assetIdPrefix || 'ASSET';

	const assetType = userEdits.assetType || extraction.parsed.assetType || 'other';
	const assetId = generateAssetId(prefix, assetType);

	const digitalSourceType =
		userEdits.digitalSourceType ||
		extraction.parsed.digitalSourceType ||
		config?.defaultDigitalSourceType ||
		'';

	// Calculate final completeness
	let completeness = extraction.completeness;
	if (userEdits.description) completeness += 15;
	if (userEdits.assetType && userEdits.assetType !== 'other') completeness += 10;
	if (userEdits.generationDate) completeness += 10;
	if (digitalSourceType) completeness += 15;
	completeness = Math.min(100, completeness);

	// Insert asset
	const asset = db
		.insert(assets)
		.values({
			assetId,
			description: userEdits.description || '',
			filePath: extraction.fileInfo.path,
			fileHash: extraction.fileInfo.hash,
			fileSize: extraction.fileInfo.size,
			mimeType: extraction.fileInfo.mimeType,
			assetType,
			platform: extraction.platform,
			digitalSourceType,
			completeness,
			generationDate: userEdits.generationDate || extraction.parsed.generationDate || '',
			notes: userEdits.notes || ''
		})
		.returning()
		.get();

	// Insert raw metadata
	const rawMeta = extraction.rawMetadata;
	if (rawMeta.exif) {
		db.insert(assetMetadata)
			.values({
				assetId: asset.id,
				metadataType: 'exif',
				rawJson: JSON.stringify(rawMeta.exif)
			})
			.run();
	}
	if (rawMeta.pngText) {
		// Store ComfyUI workflow/prompt separately for easy access
		if (rawMeta.pngText.workflow) {
			db.insert(assetMetadata)
				.values({
					assetId: asset.id,
					metadataType: 'comfyui_workflow',
					rawJson: rawMeta.pngText.workflow
				})
				.run();
		}
		if (rawMeta.pngText.prompt) {
			db.insert(assetMetadata)
				.values({
					assetId: asset.id,
					metadataType: 'comfyui_prompt',
					rawJson: rawMeta.pngText.prompt
				})
				.run();
		}
		// Store all PNG text chunks
		db.insert(assetMetadata)
			.values({
				assetId: asset.id,
				metadataType: 'png_text',
				rawJson: JSON.stringify(rawMeta.pngText)
			})
			.run();
	}
	if (rawMeta.c2pa) {
		db.insert(assetMetadata)
			.values({
				assetId: asset.id,
				metadataType: 'c2pa',
				rawJson: JSON.stringify(rawMeta.c2pa)
			})
			.run();
	}

	// Insert generation params
	const p = extraction.parsed;
	db.insert(generationParams)
		.values({
			assetId: asset.id,
			prompt: p.prompt || '',
			negativePrompt: p.negativePrompt || '',
			modelName: p.modelName || '',
			modelVersion: p.modelVersion || '',
			seed: p.seed || '',
			steps: p.steps || 0,
			cfgScale: p.cfgScale || '',
			sampler: p.sampler || '',
			scheduler: p.scheduler || '',
			width: p.width || extraction.fileInfo.width || 0,
			height: p.height || extraction.fileInfo.height || 0,
			aspectRatio: p.aspectRatio || '',
			stylize: p.stylize || '',
			styleRaw: p.styleRaw || '',
			loras: JSON.stringify(p.loras || []),
			controlnets: JSON.stringify(p.controlnets || []),
			otherParams: JSON.stringify(p.otherParams || {})
		})
		.run();

	return asset;
}
