import { Router } from 'express';
import { ASSET_TYPES, RELATIONSHIP_TYPES, listRelationshipsFor, getRelationship, unlinkRelationship, searchAssets } from '../lib/relationships/relationships.js';
import { linkWithRepropose, applyProposal } from '../lib/origin/origin.js';
import { getActiveProject } from '../lib/projects.js';

const router = Router();

// Name search across the three asset tables, for the asset pickers. A blank
// query returns the most recent assets.
router.get('/search', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	res.json({ results: await searchAssets(project.id, String(req.query.q || ''), 20) });
});

router.get('/:type/:id', async (req, res) => {
	const { type } = req.params;
	const id = parseInt(req.params.id);
	if (!ASSET_TYPES.includes(type) || !Number.isInteger(id)) return res.status(400).json({ error: 'Bad asset reference' });
	res.json(await listRelationshipsFor(type, id));
});

router.post('/', async (req, res) => {
	const { parentType, parentId, childType, childId, relationshipType = 'ingredient', notes = '' } = req.body;
	if (!ASSET_TYPES.includes(parentType) || !ASSET_TYPES.includes(childType)) return res.status(400).json({ error: 'parentType and childType must be ai, archival or produced' });
	if (!RELATIONSHIP_TYPES.includes(relationshipType)) return res.status(400).json({ error: `relationshipType must be one of ${RELATIONSHIP_TYPES.join(', ')}` });
	try {
		const rel = await linkWithRepropose({
			parentType, parentId: parseInt(parentId), childType, childId: parseInt(childId),
			relationshipType, matchMethod: 'manual', confidence: 1, notes
		});
		res.status(201).json(rel);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.delete('/:id', async (req, res) => {
	const id = parseInt(req.params.id);
	const rel = await getRelationship(id);
	if (!rel) return res.status(404).json({ error: 'Relationship not found' });
	await unlinkRelationship(id);
	// The child may have been classified through this parent; re-propose it.
	await applyProposal(rel.childAssetType, rel.childAssetId).catch(() => {});
	res.json({ success: true });
});

export default router;
