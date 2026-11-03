import { Router } from 'express';
import multer from 'multer';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getActiveProject } from '../lib/projects.js';
import { getProducedAsset } from '../lib/produced/produced.js';
import { importTimeline, getTimeline, listTimelines, updateTimelineSettings, updateSegment, recomputeTimeline, deleteTimeline } from '../lib/timeline/timelines.js';
import { formats } from '../lib/timeline/formats/index.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });

router.get('/formats', (_req, res) => {
	res.json({ formats: formats.map(f => ({ id: f.id, label: f.label })) });
});

// GET /api/timelines?producedAssetId=12
router.get('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	const producedAssetId = req.query.producedAssetId ? parseInt(req.query.producedAssetId) : undefined;
	res.json({ timelines: await listTimelines({ projectId: project.id, producedAssetId }) });
});

// POST /api/timelines  multipart: file=<xml>, producedAssetId=12
//                      or JSON: { producedAssetId, filePath }
router.post('/', upload.single('file'), async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	const producedAssetId = parseInt(req.body.producedAssetId);
	if (!Number.isInteger(producedAssetId)) return res.status(400).json({ error: 'producedAssetId required' });
	const produced = await getProducedAsset(producedAssetId);
	if (!produced || produced.projectId !== project.id) return res.status(404).json({ error: 'Produced asset not found in the active project' });

	let xmlText, sourceFileName;
	if (req.file) {
		xmlText = req.file.buffer.toString('utf8');
		sourceFileName = req.file.originalname;
	} else if (req.body.filePath) {
		if (!existsSync(req.body.filePath)) return res.status(400).json({ error: 'File not found' });
		xmlText = await readFile(req.body.filePath, 'utf8');
		sourceFileName = path.basename(req.body.filePath);
	} else {
		return res.status(400).json({ error: 'Send the timeline as a multipart "file" or a JSON filePath' });
	}

	try {
		const timeline = await importTimeline({
			project, producedAssetId, xmlText, sourceFileName,
			primaryTrackIndex: parseInt(req.body.primaryTrackIndex) || 1,
			includeOverlays: req.body.includeOverlays === 'true' || req.body.includeOverlays === true
		});
		res.status(201).json(timeline);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.get('/:id', async (req, res) => {
	const t = await getTimeline(parseInt(req.params.id));
	if (!t) return res.status(404).json({ error: 'Timeline not found' });
	res.json(t);
});

router.patch('/:id', async (req, res) => {
	const t = await getTimeline(parseInt(req.params.id));
	if (!t) return res.status(404).json({ error: 'Timeline not found' });
	res.json(await updateTimelineSettings(t.id, req.body));
});

router.post('/:id/recompute', async (req, res) => {
	const id = parseInt(req.params.id);
	try {
		await recomputeTimeline(id);
		res.json(await getTimeline(id));
	} catch (err) {
		res.status(404).json({ error: err.message });
	}
});

router.patch('/:id/segments/:segId', async (req, res) => {
	try {
		res.json(await updateSegment(parseInt(req.params.id), parseInt(req.params.segId), req.body));
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.delete('/:id', async (req, res) => {
	await deleteTimeline(parseInt(req.params.id));
	res.json({ success: true });
});

export default router;
