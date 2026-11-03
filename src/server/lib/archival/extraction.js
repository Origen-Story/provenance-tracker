import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractExif } from '../extraction/exif.js';
import { extractC2pa } from '../extraction/c2pa.js';
import { probeVideoTags } from '../extraction/video-probe.js';
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
		// Decode percent-encoding first so non-ASCII titles don't explode in length
		// after sanitize (e.g. %C3%B3 → _C3_B3 adds 6 chars per vowel on every
		// Catalan/Spanish title, easily blowing past Windows' 260-char MAX_PATH).
		try { filename = decodeURIComponent(path.basename(urlPath)); }
		catch { filename = path.basename(urlPath); }
	}

	filename = sanitizeFilename(filename || 'image');

	// Cap stem length to keep the full path comfortably under Windows MAX_PATH (260).
	// Storage root + uniqueness suffix + extension typically add ~80 chars; 120 leaves
	// safe margin. Hash collision is unrealistic here — filesystem uniqueness handles dupes.
	const stemExt = path.extname(filename);
	const stem = path.basename(filename, stemExt);
	if (stem.length > 120) filename = stem.slice(0, 120) + stemExt;

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

	// Video and audio files get their technical fields normalised here so the
	// import form can show them and createProducedAsset can store them.
	const isAv = mimeType.startsWith('video/') || mimeType.startsWith('audio/');
	const av = isAv ? probeVideoTags(tags) : null;

	return {
		filePath,
		filename,
		fileHash,
		fileSize,
		mimeType,
		width: width || av?.width || 0,
		height: height || av?.height || 0,
		durationSeconds: av?.durationSeconds ?? null,
		frameRate: av?.frameRate ?? null,
		container: av?.container || '',
		videoCodec: av?.videoCodec || '',
		audioCodec: av?.audioCodec || '',
		exifJson: JSON.stringify(exifSummary),
		c2paJson: c2paManifest ? JSON.stringify(c2paManifest) : null,
		suggestedCreator: tags?.Creator || tags?.Artist || tags?.Author || '',
		suggestedCaption: tags?.Description || tags?.ImageDescription || tags?.Caption || '',
		suggestedOriginalDate: tags?.DateTimeOriginal || tags?.CreateDate || ''
	};
}
