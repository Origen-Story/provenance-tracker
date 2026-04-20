import { Router } from 'express';
import { getArchivalAsset, listArchivalAssets, markNotionSynced } from '../lib/archival/archival.js';
import { getActiveProject } from '../lib/projects.js';
import { syncAssetToNotion, isNotionConfigured } from '../lib/archival/notion.js';

const router = Router();

router.get('/status', async (req, res) => {
	const project = await getActiveProject();
	res.json({ configured: isNotionConfigured(project) });
});

router.post('/sync/:id', async (req, res) => {
	const asset = await getArchivalAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });

	const project = await getActiveProject();
	if (!isNotionConfigured(project)) {
		return res.status(400).json({ error: 'Notion is not configured for this project' });
	}

	try {
		console.log(`[notion] Syncing asset ${asset.id}: "${asset.name?.slice(0, 40)}" (pageId: ${asset.notionPageId || 'new'})`);
		const { notionPageId } = await syncAssetToNotion(asset, project);
		await markNotionSynced(asset.id, notionPageId);
		res.json({ success: true, notionPageId });
	} catch (err) {
		console.error(`[notion] FAILED asset ${asset.id}: ${err.message}`);
		res.status(500).json({ error: err.message });
	}
});

router.post('/sync-all', async (req, res) => {
	const project = await getActiveProject();
	if (!isNotionConfigured(project)) {
		return res.status(400).json({ error: 'Notion is not configured for this project' });
	}

	const { assets } = await listArchivalAssets(project.id, { limit: 1000 });
	const results = { synced: 0, failed: 0, errors: [] };

	for (const asset of assets) {
		try {
			console.log(`[notion] Syncing asset ${asset.id}: "${asset.name?.slice(0, 40)}" (pageId: ${asset.notionPageId || 'new'})`);
			const { notionPageId } = await syncAssetToNotion(asset, project);
			await markNotionSynced(asset.id, notionPageId);
			results.synced++;
		} catch (err) {
			console.error(`[notion] FAILED asset ${asset.id}: ${err.message}`);
			results.failed++;
			results.errors.push({ id: asset.id, name: asset.name, error: err.message });
		}
	}

	res.json(results);
});

export default router;
