// List the importable files in a folder, optionally with its subfolders.
//
// Skipped: hidden entries (".something"), the tracker's own signed copies
// (`*.signed.v<N>.*`, and `signed` folders), sidecar manifests (`.c2pa`),
// and anything whose extension is not a supported media type. Symlinked
// folders are not followed, so a link cannot send the walk in a loop.
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const IMPORTABLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.svg', '.mp4', '.mov', '.mp3', '.wav', '.flac', '.ogg']);
const MAX_DEPTH = 12;

export function isImportableName(name) {
	if (name.startsWith('.')) return false;
	if (/\.signed\.v\d+\.[^.]+$/i.test(name)) return false;
	return IMPORTABLE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * @returns {Promise<{ files: Array<{ name, path, relativePath }>, skippedFolders: string[] }>}
 *   skippedFolders lists subfolders that were not entered (only when not recursive).
 */
export async function listImportableFiles(root, { recursive = false } = {}) {
	const files = [];
	const skippedFolders = [];
	async function walk(dir, depth) {
		const entries = await readdir(dir, { withFileTypes: true });
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (e.name.startsWith('.') || e.name.toLowerCase() === 'signed') continue;
				if (!recursive || depth >= MAX_DEPTH) { if (depth === 0) skippedFolders.push(e.name); continue; }
				await walk(full, depth + 1);
			} else if (e.isFile() && isImportableName(e.name)) {
				files.push({ name: e.name, path: full, relativePath: path.relative(root, full) });
			}
		}
	}
	await walk(root, 0);
	return { files, skippedFolders };
}
