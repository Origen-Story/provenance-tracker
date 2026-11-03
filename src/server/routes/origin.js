import { Router } from 'express';
import { ORIGIN_CLASSES, setOriginClass, applyProposal, proposeForAsset, reproposeProject } from '../lib/origin/origin.js';
import { ASSET_TYPES } from '../lib/relationships/relationships.js';
import { getActiveProject } from '../lib/projects.js';

const router = Router();

function parseRef(req, res) {
	const { type } = req.params;
	const id = parseInt(req.params.id);
	if (!ASSET_TYPES.includes(type) || !Number.isInteger(id)) {
		res.status(400).json({ error: `type must be one of ${ASSET_TYPES.join(', ')} and id an integer` });
		return null;
	}
	return { type, id };
}

router.get('/classes', (_req, res) => {
	res.json({ classes: ORIGIN_CLASSES });
});

// What the classifier would say now, without writing it.
router.get('/:type/:id/proposal', async (req, res) => {
	const ref = parseRef(req, res);
	if (!ref) return;
	try {
		const { proposal, signals } = await proposeForAsset(ref.type, ref.id);
		res.json({ proposal, parent: signals.parentRef });
	} catch (err) {
		res.status(404).json({ error: err.message });
	}
});

// Re-run the classifier and write the result (overrides a confirmed class).
router.post('/:type/:id/propose', async (req, res) => {
	const ref = parseRef(req, res);
	if (!ref) return;
	try {
		const { row, proposal } = await applyProposal(ref.type, ref.id, { force: true });
		res.json({ asset: row, proposal });
	} catch (err) {
		res.status(404).json({ error: err.message });
	}
});

// User sets or confirms the class.
router.patch('/:type/:id', async (req, res) => {
	const ref = parseRef(req, res);
	if (!ref) return;
	const { originClass, confirmed = true, ingredientClasses } = req.body;
	try {
		const row = await setOriginClass(ref.type, ref.id, { originClass, confirmed, ingredientClasses });
		res.json(row);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

// Propose for every unconfirmed row in the active project.
router.post('/repropose', async (_req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	res.json(await reproposeProject(project.id));
});

export default router;
