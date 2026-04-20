import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractExif } from '../extraction/exif.js';
import { extractC2pa } from '../extraction/c2pa.js';
import { computeFileHash, getMimeType, getFileSize } from '../core/file-utils.js';
import { USER_AGENT } from '../user-agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function getArchivalImagesDir(projectStoragePath) {
	if (projectStoragePath) return path.join(projectStoragePath, 'archival-images');
	if (process.env.STORAGE_PATH) return path.join(process.env.STORAGE_PATH, 'archival-images');
	return path.resolve(__dirname, '../../../../../data/archival-images');
}

const CONTENT_TYPE_EXT = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/gif': '.gif',
	'image/webp': '.webp',
	'image/tiff': '.tif',
	'image/bmp': '.bmp',
	'image/svg+xml': '.svg'
};

function sanitizeFilename(raw) {
	return raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
}

function uniqueFilePath(dir, filename) {
	const ext = path.extname(filename);
	const base = path.basename(filename, ext);
	let candidate = path.join(dir, filename);
	let i = 1;
	while (existsSync(candidate) && i < 100) {
		candidate = path.join(dir, `${base}_${i}${ext}`);
		i++;
	}
	return candidate;
}

export async function downloadAndExtract(sourceUrl, projectStoragePath = null) {
	const response = await fetch(sourceUrl, {
		headers: { 'User-Agent': USER_AGENT }
	});
	if (!response.ok) {
		// On 429, surface Retry-After (seconds) so the queue can honor the server's ask
		const retryAfter = response.status === 429 ? response.headers.get('retry-after') : null;
		const suffix = retryAfter ? ` [retry-after:${retryAfter}]` : '';
		throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}${suffix}`);
	}

	const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
	if (!contentType.startsWith('image/')) {
		throw new Error(`URL did not return an image (got ${contentType || 'unknown content type'}). Make sure you're linking directly to the image file, not a web page.`);
	}

	const disposition = response.headers.get('content-disposition') || '';
	let filename = '';

	const dispMatch = disposition.match(/filename\*?=["']?(?:UTF-8'')?([^"';\s]+)/i);
	if (dispMatch) filename = decodeURIComponent(dispMatch[1]);

	if (!filename) {
		const urlPath = new URL(sourceUrl).pathname;
		filename = path.basename(urlPath);
	}

	filename = sanitizeFilename(filename || 'image');
	if (!path.extname(filename) && CONTENT_TYPE_EXT[contentType]) {
		filename += CONTENT_TYPE_EXT[contentType];
	}

	const archivalImagesDir = getArchivalImagesDir(projectStoragePath);
	if (!existsSync(archivalImagesDir)) {
		await mkdir(archivalImagesDir, { recursive: true });
	}

	const filePath = uniqueFilePath(archivalImagesDir, filename);
	const buffer = Buffer.from(await response.arrayBuffer());
	await writeFile(filePath, buffer);

	return extractExifFromPath(filePath);
}

export async function extractExifFromPath(filePath) {
	const tags = await extractExif(filePath);
	const [fileHash, fileSize, c2paManifest] = await Promise.all([
		computeFileHash(filePath),
		getFileSize(filePath),
		extractC2pa(filePath)
	]);
	const mimeType = getMimeType(filePath);
	const filename = path.basename(filePath);

	const width = tags?.ImageWidth || tags?.ExifImageWidth || 0;
	const height = tags?.ImageHeight || tags?.ExifImageHeight || 0;

	const skipKeys = new Set(['SourceFile', 'ExifToolVersion', 'FileInodeChangeDate', 'FilePermissions']);
	const exifSummary = {};
	if (tags) {
		for (const [k, v] of Object.entries(tags)) {
			if (!skipKeys.has(k) && typeof v !== 'object') exifSummary[k] = v;
		}
	}

	return {
		filePath,
		filename,
		fileHash,
		fileSize,
		mimeType,
		width,
		height,
		exifJson: JSON.stringify(exifSummary),
		c2paJson: c2paManifest ? JSON.stringify(c2paManifest) : null,
		suggestedCreator: tags?.Creator || tags?.Artist || tags?.Author || '',
		suggestedCaption: tags?.Description || tags?.ImageDescription || tags?.Caption || '',
		suggestedOriginalDate: tags?.DateTimeOriginal || tags?.CreateDate || ''
	};
}
