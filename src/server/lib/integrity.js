import { db } from '../db/index.js';
import { assets, archivalAssets, producedAssets } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';

const SUPPORTED = new Set([
	'.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.svg',
	'.mp4', '.mov', '.mp3', '.wav', '.flac', '.ogg'
]);

/**
 * Run an integrity check for a project.
 * Returns orphan files (in managed folders but not in DB)
 * and missing files (in DB but not on disk).
 */
export async function checkProjectIntegrity(project) {
	if (!project?.storagePath) {
		return { orphanFiles: [], missingFiles: [], error: 'No storage path configured for this project.' };
	}

	const base = project.storagePath;
	const folders = {
		'ai-assets': { dir: path.join(base, 'ai-assets'), table: 'assets' },
		'archival-images': { dir: path.join(base, 'archival-images'), table: 'archival' },
		'produced-assets': { dir: path.join(base, 'produced-assets'), table: 'produced' }
	};

	// 1. Get all tracked file paths from DB for this project
	const [aiRows, archRows, prodRows] = await Promise.all([
		db.select({ filePath: assets.filePath, id: assets.id, assetId: assets.assetId })
			.from(assets).where(eq(assets.projectId, project.id)),
		db.select({ filePath: archivalAssets.filePath, id: archivalAssets.id, name: archivalAssets.name })
			.from(archivalAssets).where(eq(archivalAssets.projectId, project.id)),
		db.select({ filePath: producedAssets.filePath, id: producedAssets.id, name: producedAssets.name })
			.from(producedAssets).where(eq(producedAssets.projectId, project.id))
	]);

	// Normalize all tracked paths for comparison
	const normalize = (p) => path.resolve(p).toLowerCase();
	const trackedPaths = new Set();

	const allDbRecords = [];
	for (const row of aiRows) {
		trackedPaths.add(normalize(row.filePath));
		allDbRecords.push({ ...row, type: 'ai-assets', label: row.assetId });
	}
	for (const row of archRows) {
		trackedPaths.add(normalize(row.filePath));
		allDbRecords.push({ ...row, type: 'archival', label: row.name || `archival #${row.id}` });
	}
	for (const row of prodRows) {
		trackedPaths.add(normalize(row.filePath));
		allDbRecords.push({ ...row, type: 'produced', label: row.name || `produced #${row.id}` });
	}

	// 2. Scan managed storage folders for orphan files
	const orphanFiles = [];
	for (const [folderName, { dir }] of Object.entries(folders)) {
		if (!existsSync(dir)) continue;
		const entries = await readdir(dir);
		for (const entry of entries) {
			const fullPath = path.join(dir, entry);
			const s = await stat(fullPath).catch(() => null);
			if (!s || !s.isFile()) continue;
			const ext = path.extname(entry).toLowerCase();
			if (!SUPPORTED.has(ext)) continue;
			if (!trackedPaths.has(normalize(fullPath))) {
				orphanFiles.push({
					filePath: fullPath,
					filename: entry,
					folder: folderName,
					size: s.size
				});
			}
		}
	}

	// 3. Check DB records for missing files on disk
	const missingFiles = [];
	for (const record of allDbRecords) {
		if (!existsSync(record.filePath)) {
			missingFiles.push({
				id: record.id,
				type: record.type,
				label: record.label,
				filePath: record.filePath
			});
		}
	}

	return {
		orphanFiles,
		missingFiles,
		tracked: allDbRecords.length,
		onDisk: allDbRecords.length - missingFiles.length + orphanFiles.length
	};
}
