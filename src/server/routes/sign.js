// Sign one asset with Content Credentials (phase 4c, through c2patool).
//
// POST /api/sign/:type/:id   body { creatorName, organization, toolUsed,
//                                   isAiGenerated, identityUrl,
//                                   trainingMiningOptOut, timestamp }
// GET  /api/sign/:type/:id   the asset's signed copies, newest first
//
// Writes a new `<name>.signed.v<N>.<ext>` beside the original and records it
// in `signatures`. The asset row keeps the original path and hash.

import { Router } from 'express';
import { getActiveProject } from '../lib/projects.js';
import { signOneAsset, listSignatures } from '../lib/manifest/signing.js';
import { DEFAULT_TIMESTAMP_URL } from '../lib/manifest/generator.js';
import { ASSET_TYPES } from '../lib/relationships/relationships.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('sign-route');
const router = Router();

function parse(req, res) {
	const { type } = req.params;
	const id = parseInt(req.params.id);
	if (!ASSET_TYPES.includes(type) || !Number.isInteger(id)) {
		res.status(400).json({ error: `Expected /api/sign/<${ASSET_TYPES.join('|')}>/<id>` });
		return null;
	}
	return { type, id };
}

router.get('/:type/:id', async (req, res) => {
	const p = parse(req, res);
	if (!p) return;
	res.json({ signatures: await listSignatures(p.type, p.id) });
});

router.post('/:type/:id', async (req, res) => {
	const p = parse(req, res);
	if (!p) return;
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	const body = req.body || {};
	if (!body.creatorName) return res.status(400).json({ error: 'creatorName is required' });
	try {
		const sig = await signOneAsset(project, p.type, p.id, {
			creatorName: body.creatorName,
			organization: body.organization,
			toolUsed: body.toolUsed,
			isAiGenerated: !!body.isAiGenerated,
			identityUrl: body.identityUrl || body.cawgIdentityUrl,
			trainingMiningOptOut: body.trainingMiningOptOut !== false,
			timestampUrl: body.timestamp === false ? '' : DEFAULT_TIMESTAMP_URL
		});
		log.info(`signed ${p.type} asset ${p.id}: version ${sig.version}, ${sig.status}`);
		res.json(sig);
	} catch (err) {
		log.error(`sign failed for ${p.type}/${p.id}: ${err.message}`);
		res.status(err.status || 500).json({ error: err.message });
	}
});

export default router;
