import { Router } from 'express';
import { listProducedAssets, getProducedAsset, createProducedAsset, updateProducedAsset, deleteProducedAsset } from '../lib/produced/produced.js';
import { getActiveProject } from '../lib/projects.js';

const router = Router();

router.get('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { search = '', assetType = '', enrichment = '', sort = 'createdAt', dir = 'desc', limit = 100, offset = 0 } = req.query;
	const result = await listProducedAssets(project.id, {
		search, assetType, enrichment, sortBy: sort, sortDir: dir,
		limit: parseInt(limit), offset: parseInt(offset)
	});
	res.json(result);
});

router.get('/:id', async (req, res) => {
	const asset = await getProducedAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });
	res.json(asset);
});

router.post('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	try {
		const asset = await createProducedAsset(project.id, req.body);
		res.status(201).json(asset);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.patch('/:id', async (req, res) => {
	const asset = await getProducedAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });
	const updated = await updateProducedAsset(parseInt(req.params.id), req.body);
	res.json(updated);
});

router.delete('/:id', async (req, res) => {
	try {
		await deleteProducedAsset(parseInt(req.params.id));
		res.json({ success: true });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

export default router;
