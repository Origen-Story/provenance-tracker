import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { mkdir, readdir, stat, copyFile, unlink } from 'fs/promises';
import { getActiveProject } from '../lib/projects.js';
import { extractAIAsset } from '../lib/extraction/ai-extraction.js';
import { extractExifFromPath } from '../lib/archival/extraction.js';
import { computeFileHash } from '../lib/core/file-utils.js';
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
 * POST /api/upload/scan
 * Scan a local folder, copy files into managed storage, run extraction on each.
 *
 * Body: { folderPath, module, deleteOriginals }
 */
router.post('/scan', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { folderPath, module = 'ai-assets', deleteOriginals = false } = req.body;
	if (!folderPath) return res.status(400).json({ error: 'folderPath required' });
	if (!existsSync(folderPath)) return res.status(400).json({ error: 'Folder not found' });

	const storageDir = getStorageDir(project, module);
	if (!existsSync(storageDir)) {
		await mkdir(storageDir, { recursive: true });
	}

	// Supported file extensions
	const SUPPORTED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.svg', '.mp4', '.mov', '.mp3', '.wav', '.flac', '.ogg']);

	const entries = await readdir(folderPath);
	const files = [];
	// Track subdirectories to warn the user
	const subdirs = [];
	for (const entry of entries) {
		const fullPath = path.join(folderPath, entry);
		const s = await stat(fullPath);
		if (s.isDirectory()) {
			subdirs.push(entry);
			continue;
		}
		const ext = path.extname(entry).toLowerCase();
		if (!SUPPORTED.has(ext)) continue;
		if (s.isFile()) files.push({ name: entry, path: fullPath, size: s.size });
	}

	if (files.length === 0) {
		return res.json({
			results: [],
			subdirectories: subdirs,
			message: 'No supported files found in this folder.' + (subdirs.length ? ` Note: ${subdirs.length} subdirector${subdirs.length === 1 ? 'y' : 'ies'} found but not scanned (${subdirs.join(', ')}).` : '')
		});
	}

	const results = [];
	let deleted = 0;
	let duplicates = 0;

	for (const file of files) {
		try {
			// Compute hash from source first for duplicate check
			const fileHash = await computeFileHash(file.path);
			const dup = await findDuplicateByHash(project.id, fileHash, module);
			if (dup) {
				duplicates++;
				// Delete the original even if it's a duplicate, if the flag is set
				if (deleteOriginals) {
					await unlink(file.path).catch(() => {});
					deleted++;
				}
				results.push({
					success: false,
					filename: file.name,
					duplicate: true,
					existingAsset: dup,
					error: `Duplicate: already in catalog${dup.name ? ` as "${dup.name}"` : dup.assetId ? ` as ${dup.assetId}` : ''}`
				});
				continue;
			}

			const destPath = uniqueName(storageDir, file.name);
			await copyFile(file.path, destPath);

			// Delete original if requested
			if (deleteOriginals) {
				await unlink(file.path).catch(() => {});
				deleted++;
			}

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
			results.push({ success: false, filename: file.name, error: err.message });
		}
	}

	res.json({
		results,
		subdirectories: subdirs,
		deleted: deleteOriginals ? deleted : 0,
		duplicates
	});
});

/**
 * POST /api/upload/file
 * Import a single file by path. Copies to managed storage, runs extraction.
 *
 * Body: { filePath, module, deleteOriginal }
 */
router.post('/file', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { filePath, module = 'ai-assets', deleteOriginal = false } = req.body;
	if (!filePath) return res.status(400).json({ error: 'filePath required' });
	if (!existsSync(filePath)) return res.status(400).json({ error: 'File not found' });

	const storageDir = getStorageDir(project, module);
	if (!existsSync(storageDir)) {
		await mkdir(storageDir, { recursive: true });
	}

	try {
		// Check for duplicates by hash first
		const fileHash = await computeFileHash(filePath);
		const dup = await findDuplicateByHash(project.id, fileHash, module);
		if (dup) {
			if (deleteOriginal) await unlink(filePath).catch(() => {});
			return res.status(409).json({
				error: `Duplicate: this file already exists in the catalog${dup.name ? ` as "${dup.name}"` : dup.assetId ? ` as ${dup.assetId}` : ''}`,
				duplicate: true,
				existingAsset: dup
			});
		}

		const filename = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
		const destPath = uniqueName(storageDir, filename);
		await copyFile(filePath, destPath);

		if (deleteOriginal) await unlink(filePath).catch(() => {});

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

		res.json({ success: true, deleted: deleteOriginal, ...extracted });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

export default router;
