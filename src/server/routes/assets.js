import { Router } from 'express';
import { listAssets, getAsset, createAsset, updateAsset, deleteAsset } from '../lib/assets/assets.js';
import { extractAIAsset } from '../lib/extraction/ai-extraction.js';
import { getActiveProject } from '../lib/projects.js';

const router = Router();

// Extract metadata from a local file path (preview before saving)
router.post('/extract', async (req, res) => {
	const { filePath } = req.body;
	if (!filePath) return res.status(400).json({ error: 'filePath required' });
	try {
		const result = await extractAIAsset(filePath.trim());
		res.json(result);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.get('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { search = '', assetType = '', platform = '', enrichment = '', sort = 'createdAt', dir = 'desc', limit = 100, offset = 0 } = req.query;
	const result = await listAssets(project.id, {
		search, assetType, platform, enrichment, sortBy: sort, sortDir: dir,
		limit: parseInt(limit), offset: parseInt(offset)
	});
	res.json(result);
});

router.get('/:id', async (req, res) => {
	const asset = await getAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });
	res.json(asset);
});

router.post('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	try {
		const asset = await createAsset(project.id, req.body);
		res.status(201).json(asset);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.patch('/:id', async (req, res) => {
	const asset = await getAsset(parseInt(req.params.id));
	if (!asset) return res.status(404).json({ error: 'Asset not found' });
	const updated = await updateAsset(parseInt(req.params.id), req.body);
	res.json(updated);
});

router.delete('/:id', async (req, res) => {
	try {
		await deleteAsset(parseInt(req.params.id));
		res.json({ success: true });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

export default router;
