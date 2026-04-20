import { Router } from 'express';
import { downloadAndExtract, extractExifFromPath } from '../lib/archival/extraction.js';
import { getActiveProject } from '../lib/projects.js';

const router = Router();

router.post('/', async (req, res) => {
	const { mode, sourceUrl, filePath } = req.body;

	if (mode === 'url') {
		if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl required' });
		try {
			const project = await getActiveProject();
			const result = await downloadAndExtract(sourceUrl.trim(), project?.storagePath || null);
			result.accessDate = new Date().toISOString().slice(0, 10);
			result.sourceUrl = sourceUrl.trim();
			res.json(result);
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
		return;
	}

	if (mode === 'local') {
		if (!filePath) return res.status(400).json({ error: 'filePath required' });
		try {
			const result = await extractExifFromPath(filePath.trim());
			result.accessDate = new Date().toISOString().slice(0, 10);
			result.sourceUrl = '';
			res.json(result);
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
		return;
	}

	res.status(400).json({ error: 'mode must be "url" or "local"' });
});

export default router;
