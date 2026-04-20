import { Router } from 'express';
import { existsSync } from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { archivalAssets } from '../db/schema.js';
import { eq, and, sql, ne } from 'drizzle-orm';
import { listArchivalAssets, getArchivalAsset, createArchivalAsset, updateArchivalAsset, deleteArchivalAsset, markNotionSynced } from '../lib/archival/archival.js';
import { getActiveProject } from '../lib/projects.js';

const router = Router();

router.get('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { search = '', medium = '', enrichment = '', searchGroupId = '', sort = 'createdAt', dir = 'desc', limit = 100, offset = 0 } = req.query;
	const result = await listArchivalAssets(project.id, {
		search, medium, enrichment, searchGroupId, sortBy: sort, sortDir: dir,
		limit: parseInt(limit), offset: parseInt(offset)
	});
	res.json(result);
});

// Distinct search groups for the active project — for filter dropdown
router.get('/groups', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const rows = await db.select({
		id: archivalAssets.searchGroupId,
		name: archivalAssets.searchGroupName
	})
		.from(archivalAssets)
		.where(and(eq(archivalAssets.projectId, project.id), ne(archivalAssets.searchGroupId, '')))
		.groupBy(archivalAssets.searchGroupId, archivalAssets.searchGroupName)
		.orderBy(archivalAssets.searchGroupName);
	res.json(rows);
});

router.get('/:id', async (req, res) => {
	const asset = await getArchivalAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });
	res.json(asset);
});

router.post('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	try {
		const asset = await createArchivalAsset(project.id, req.body);
		res.status(201).json(asset);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.patch('/:id', async (req, res) => {
	const asset = await getArchivalAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });
	const updated = await updateArchivalAsset(parseInt(req.params.id), req.body);
	res.json(updated);
});

router.get('/:id/download', async (req, res) => {
	const asset = await getArchivalAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });

	if (!asset.filePath || !existsSync(asset.filePath)) {
		return res.status(404).json({ error: 'File not found on disk' });
	}

	const ext = path.extname(asset.filename || asset.filePath);
	const downloadName = asset.filename || `asset-${asset.id}${ext}`;
	res.download(asset.filePath, downloadName);
});

router.delete('/:id', async (req, res) => {
	const asset = await getArchivalAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });
	await deleteArchivalAsset(parseInt(req.params.id));
	res.json({ success: true });
});

export default router;
