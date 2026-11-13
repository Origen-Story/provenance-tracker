import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { mkdir, copyFile, unlink } from 'fs/promises';
import { getActiveProject } from '../lib/projects.js';
import { extractAIAsset } from '../lib/extraction/ai-extraction.js';
import { extractExifFromPath } from '../lib/archival/extraction.js';
import { computeFileHash } from '../lib/core/file-utils.js';
import { listImportableFiles } from '../lib/core/scan-folder.js';
import { db } from '../db/index.js';
import { assets, archivalAssets, producedAssets } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE = path.resolve(__dirname, '../../../data');

const MODULE_FOLDERS = {
	'archival': 'archival-images',
	'ai-assets': 'ai-assets',
	'produced': 'produced-assets'
};

function getStorageDir(project, module) {
	const base = project?.storagePath || DEFAULT_STORAGE;
	const folder = MODULE_FOLDERS[module] || module;
	return path.join(base, folder);
}

function uniqueName(dir, filename) {
	const ext = path.extname(filename);
	const base = path.basename(filename, ext);
	let candidate = path.join(dir, filename);
	let i = 1;
	while (existsSync(candidate) && i < 1000) {
		candidate = path.join(dir, `${base}_${i}${ext}`);
		i++;
	}
	return candidate;
}

/**
 * Check if a file hash already exists in any asset table for this project.
 * Returns the existing asset info if found, null otherwise.
 */
async function findDuplicateByHash(projectId, fileHash, module) {
	if (!fileHash) return null;

	if (module === 'archival') {
		const [row] = await db.select({ id: archivalAssets.id, name: archivalAssets.name, filename: archivalAssets.filename })
			.from(archivalAssets)
			.where(and(eq(archivalAssets.projectId, projectId), eq(archivalAssets.fileHash, fileHash)))
			.limit(1);
		return row ? { ...row, type: 'archival' } : null;
	} else if (module === 'produced') {
		const [row] = await db.select({ id: producedAssets.id, name: producedAssets.name, filename: producedAssets.filename })
			.from(producedAssets)
			.where(and(eq(producedAssets.projectId, projectId), eq(producedAssets.fileHash, fileHash)))
			.limit(1);
		return row ? { ...row, type: 'produced' } : null;
	} else {
		const [row] = await db.select({ id: assets.id, assetId: assets.assetId })
			.from(assets)
			.where(and(eq(assets.projectId, projectId), eq(assets.fileHash, fileHash)))
			.limit(1);
		return row ? { ...row, type: 'ai-assets' } : null;
	}
}

// Multer config — store to temp, we move to managed storage after
const upload = multer({
	storage: multer.diskStorage({
		destination: (req, file, cb) => {
			const tmpDir = path.resolve(DEFAULT_STORAGE, '_tmp');
			if (!existsSync(tmpDir)) {
				mkdir(tmpDir, { recursive: true }).then(() => cb(null, tmpDir));
			} else {
				cb(null, tmpDir);
			}
		},
		filename: (req, file, cb) => {
			const clean = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
			cb(null, `${Date.now()}_${clean}`);
		}
	}),
	limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});

const router = Router();

/**
 * POST /api/upload
 * Accepts multipart file upload(s). Moves them to managed storage,
 * runs extraction, returns results for each file.
 *
 * Body fields:
 *   module: "ai-assets" | "archival" | "produced"
 *   deleteOriginals: "true" | "false" (default false) — for upload, always deletes temp
 */
router.post('/', upload.array('files', 50), async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const module = req.body.module || 'ai-assets';
	const storageDir = getStorageDir(project, module);

	if (!existsSync(storageDir)) {
		await mkdir(storageDir, { recursive: true });
	}

	const results = [];

	for (const file of (req.files || [])) {
		try {
			// Move from temp to managed storage
			const destPath = uniqueName(storageDir, file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
			await copyFile(file.path, destPath);
			// Always clean up temp file (this isn't the user's original)
			await unlink(file.path).catch(() => {});

			// Check for duplicates by hash
			const fileHash = await computeFileHash(destPath);
			const dup = await findDuplicateByHash(project.id, fileHash, module);
			if (dup) {
				// Remove the copy we just made
				await unlink(destPath).catch(() => {});
				results.push({
					success: false,
					filename: file.originalname,
					duplicate: true,
					existingAsset: dup,
					error: `Duplicate: this file already exists in the catalog${dup.name ? ` as "${dup.name}"` : dup.assetId ? ` as ${dup.assetId}` : ''}`
				});
				continue;
			}

			// Run extraction based on module
			let extracted;
			if (module === 'archival') {
				extracted = await extractExifFromPath(destPath);
				extracted.accessDate = new Date().toISOString().slice(0, 10);
				extracted.sourceUrl = '';
			} else if (module === 'produced') {
				extracted = await extractExifFromPath(destPath);
				extracted.recordingDate = '';
			} else {
				extracted = await extractAIAsset(destPath);
			}

			results.push({ success: true, ...extracted });
		} catch (err) {
			results.push({ success: false, filename: file.originalname, error: err.message });
		}
	}

	res.json({ results });
});

/**
 * Import one file that already exists on disk. Managed: copy it into the
 * project's storage folder and extract from the copy. In place (D12): extract
 * from the file where it is and record that path; nothing is copied, and the
 * tracker never moves, renames or deletes it.
 */
async function importExisting({ project, sourcePath, module, inPlace, deleteOriginal }) {
	const fileHash = await computeFileHash(sourcePath);
	const dup = await findDuplicateByHash(project.id, fileHash, module);
	if (dup) {
		if (deleteOriginal && !inPlace) await unlink(sourcePath).catch(() => {});
		return { duplicate: true, existingAsset: dup, error: `Duplicate: already in catalog${dup.name ? ` as "${dup.name}"` : dup.assetId ? ` as ${dup.assetId}` : ''}` };
	}
	let filePath = sourcePath;
	if (!inPlace) {
		const storageDir = getStorageDir(project, module);
		if (!existsSync(storageDir)) await mkdir(storageDir, { recursive: true });
		filePath = uniqueName(storageDir, path.basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, '_'));
		await copyFile(sourcePath, filePath);
		if (deleteOriginal) await unlink(sourcePath).catch(() => {});
	}
	let extracted;
	if (module === 'archival') {
		extracted = await extractExifFromPath(filePath);
		extracted.accessDate = new Date().toISOString().slice(0, 10);
		extracted.sourceUrl = '';
	} else if (module === 'produced') {
		extracted = await extractExifFromPath(filePath);
		extracted.recordingDate = '';
	} else {
		extracted = await extractAIAsset(filePath);
	}
	return { extracted: { ...extracted, inPlace: !!inPlace } };
}

function refuseDeletingTrackedFiles(inPlace, deleteOriginal, res) {
	if (inPlace && deleteOriginal) {
		res.status(400).json({ error: 'A file tracked in place is the original. Untick "delete originals" to track files where they are.' });
		return true;
	}
	return false;
}

/**
 * POST /api/upload/scan
 * Import every supported file in a local folder.
 *
 * Body: { folderPath, module, inPlace, recursive, deleteOriginals }
 */
router.post('/scan', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { folderPath, module = 'ai-assets', inPlace = false, recursive = false, deleteOriginals = false } = req.body;
	if (!folderPath) return res.status(400).json({ error: 'folderPath required' });
	if (!existsSync(folderPath)) return res.status(400).json({ error: 'Folder not found' });
	if (refuseDeletingTrackedFiles(inPlace, deleteOriginals, res)) return;

	const { files, skippedFolders } = await listImportableFiles(folderPath, { recursive: !!recursive });
	if (files.length === 0) {
		return res.json({
			results: [],
			subdirectories: skippedFolders,
			message: 'No supported files found in this folder.' + (skippedFolders.length ? ` Note: ${skippedFolders.length} subfolder${skippedFolders.length === 1 ? '' : 's'} not scanned (${skippedFolders.join(', ')}). Tick "include subfolders" to scan them.` : '')
		});
	}

	const results = [];
	let duplicates = 0;
	for (const file of files) {
		try {
			const r = await importExisting({ project, sourcePath: file.path, module, inPlace, deleteOriginal: deleteOriginals });
			if (r.duplicate) {
				duplicates++;
				results.push({ success: false, filename: file.relativePath, duplicate: true, existingAsset: r.existingAsset, error: r.error });
			} else {
				results.push({ success: true, ...r.extracted });
			}
		} catch (err) {
			results.push({ success: false, filename: file.relativePath, error: err.message });
		}
	}

	res.json({
		results,
		subdirectories: skippedFolders,
		deleted: deleteOriginals && !inPlace ? results.filter(r => r.success || r.duplicate).length : 0,
		duplicates
	});
});

/**
 * POST /api/upload/file
 * Import a single file by path.
 *
 * Body: { filePath, module, inPlace, deleteOriginal }
 */
router.post('/file', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { filePath, module = 'ai-assets', inPlace = false, deleteOriginal = false } = req.body;
	if (!filePath) return res.status(400).json({ error: 'filePath required' });
	if (!existsSync(filePath)) return res.status(400).json({ error: 'File not found' });
	if (refuseDeletingTrackedFiles(inPlace, deleteOriginal, res)) return;

	try {
		const r = await importExisting({ project, sourcePath: filePath, module, inPlace, deleteOriginal });
		if (r.duplicate) return res.status(409).json({ error: r.error, duplicate: true, existingAsset: r.existingAsset });
		res.json({ success: true, deleted: !!deleteOriginal && !inPlace, ...r.extracted });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

export default router;
