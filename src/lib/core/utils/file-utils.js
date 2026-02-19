import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import path from 'path';

const MIME_MAP = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.mp4': 'video/mp4',
	'.mov': 'video/quicktime',
	'.avi': 'video/x-msvideo',
	'.mkv': 'video/x-matroska',
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.flac': 'audio/flac',
	'.pdf': 'application/pdf'
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(MIME_MAP));

export async function computeFileHash(filePath) {
	const buf = await readFile(filePath);
	return createHash('sha256').update(buf).digest('hex');
}

export function getMimeType(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	return MIME_MAP[ext] || 'application/octet-stream';
}

export function isSupportedFile(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	return SUPPORTED_EXTENSIONS.has(ext);
}

export function isPng(filePath) {
	return path.extname(filePath).toLowerCase() === '.png';
}

export function isImage(filePath) {
	const mime = getMimeType(filePath);
	return mime.startsWith('image/');
}

export async function getFileSize(filePath) {
	const stats = await stat(filePath);
	return stats.size;
}

export function normalizePath(filePath) {
	return path.resolve(filePath).replace(/\\/g, '/');
}
