// Finished edits (decision D10): the produced assets flagged as outputs,
// each with its latest timeline's composition. Flagging happens on timeline
// import, on import of a file whose credentials list ingredients, or here
// by the user.
import { Router } from 'express';
import { getActiveProject } from '../lib/projects.js';
import { getProducedAsset, markOutput } from '../lib/produced/produced.js';
import { listOutputs } from '../lib/timeline/timelines.js';

const router = Router();

router.get('/', async (_req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	res.json({ outputs: await listOutputs(project.id) });
});

// PATCH /api/outputs/:producedAssetId { isOutput: true|false }
router.patch('/:id', async (req, res) => {
	const id = parseInt(req.params.id);
	const project = await getActiveProject();
	const asset = Number.isInteger(id) ? await getProducedAsset(id) : null;
	if (!asset || !project || asset.projectId !== project.id) return res.status(404).json({ error: 'Produced asset not found in the active project' });
	if (typeof req.body.isOutput !== 'boolean') return res.status(400).json({ error: 'isOutput must be true or false' });
	try {
		res.json(await markOutput(id, 'user', req.body.isOutput));
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

export default router;
