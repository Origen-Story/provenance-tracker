// Finished edits (decision D10): the produced assets flagged as outputs,
// each with its latest timeline's composition. Flagging happens on timeline
// import, on import of a file whose credentials list ingredients, or here
// by the user.
import { Router } from 'express';
import { getActiveProject } from '../lib/projects.js';
import { getProducedAsset, markOutput } from '../lib/produced/produced.js';
import { listOutputs } from '../lib/timeline/timelines.js';
import { previewStatement, saveStatement, signOutput, listSignatures } from '../lib/manifest/signing.js';
import { DEFAULT_TIMESTAMP_URL } from '../lib/manifest/generator.js';

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

// Phase 4c: the creator statement and the signed copies of an output.
async function outputInProject(req, res) {
	const id = parseInt(req.params.id);
	const project = await getActiveProject();
	const asset = Number.isInteger(id) ? await getProducedAsset(id) : null;
	if (!asset || !project || asset.projectId !== project.id) {
		res.status(404).json({ error: 'Produced asset not found in the active project' });
		return null;
	}
	return { id, project, asset };
}

// GET: the saved words plus the statement exactly as it would be signed now.
router.get('/:id/statement', async (req, res) => {
	const ctx = await outputInProject(req, res);
	if (!ctx) return;
	try {
		res.json(await previewStatement(ctx.project, ctx.id));
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

router.put('/:id/statement', async (req, res) => {
	const ctx = await outputInProject(req, res);
	if (!ctx) return;
	const { text, authorName, organization, softwareAgent } = req.body || {};
	await saveStatement(ctx.project.id, ctx.id, { text, authorName, organization, softwareAgent });
	res.json(await previewStatement(ctx.project, ctx.id));
});

router.get('/:id/signatures', async (req, res) => {
	const ctx = await outputInProject(req, res);
	if (!ctx) return;
	res.json({ signatures: await listSignatures('produced', ctx.id), certificateConfigured: !!(ctx.project.certificatePath && ctx.project.privateKeyPath) });
});

// POST { timestamp: true|false } — sign a new versioned copy.
router.post('/:id/sign', async (req, res) => {
	const ctx = await outputInProject(req, res);
	if (!ctx) return;
	try {
		const timestampUrl = req.body?.timestamp === false ? '' : DEFAULT_TIMESTAMP_URL;
		res.json(await signOutput(ctx.project, ctx.id, { timestampUrl }));
	} catch (err) {
		res.status(err.status || 500).json({ error: err.message });
	}
});

export default router;
