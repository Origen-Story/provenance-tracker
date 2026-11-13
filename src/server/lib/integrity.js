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
	if (!project) return { orphanFiles: [], missingFiles: [], changedFiles: [], error: 'No project.' };

	// Without a storage folder there is nothing to scan for orphans, but the
	// tracked files (all of them, if the project tracks in place) still get checked.
	const base = project.storagePath;
	const folders = base ? {
		'ai-assets': { dir: path.join(base, 'ai-assets'), table: 'assets' },
		'archival-images': { dir: path.join(base, 'archival-images'), table: 'archival' },
		'produced-assets': { dir: path.join(base, 'produced-assets'), table: 'produced' }
	} : {};

	// 1. Get all tracked file paths from DB for this project
	const [aiRows, archRows, prodRows] = await Promise.all([
		db.select({ filePath: assets.filePath, id: assets.id, assetId: assets.assetId, inPlace: assets.inPlace, fileSize: assets.fileSize })
			.from(assets).where(eq(assets.projectId, project.id)),
		db.select({ filePath: archivalAssets.filePath, id: archivalAssets.id, name: archivalAssets.name, inPlace: archivalAssets.inPlace, fileSize: archivalAssets.fileSize })
			.from(archivalAssets).where(eq(archivalAssets.projectId, project.id)),
		db.select({ filePath: producedAssets.filePath, id: producedAssets.id, name: producedAssets.name, inPlace: producedAssets.inPlace, fileSize: producedAssets.fileSize })
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

	// 3. Check DB records for missing files on disk. A file tracked in place
	// (D12) lives outside managed storage and can be moved, renamed or edited
	// by other tools, so its size is also compared with the one recorded at
	// import: a different size means the file is no longer the one the record
	// describes. (Same size is not proof of the same content; re-hashing every
	// video on each check would be too slow, so this is the cheap first signal.)
	const missingFiles = [];
	const changedFiles = [];
	for (const record of allDbRecords) {
		const entry = { id: record.id, type: record.type, label: record.label, filePath: record.filePath, inPlace: !!record.inPlace };
		if (!existsSync(record.filePath)) {
			missingFiles.push(entry);
			continue;
		}
		if (record.inPlace && record.fileSize) {
			const s = await stat(record.filePath).catch(() => null);
			if (s && s.size !== record.fileSize) changedFiles.push({ ...entry, recordedSize: record.fileSize, currentSize: s.size });
		}
	}

	return {
		orphanFiles,
		missingFiles,
		changedFiles,
		tracked: allDbRecords.length,
		onDisk: allDbRecords.length - missingFiles.length + orphanFiles.length
	};
}
