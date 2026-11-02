// POST /api/sign/:type/:id  — sign an asset with C2PA Content Credentials.
//
// :type    "produced" or "ai"
// :id      asset row id
// body     { creatorName, organization, toolUsed, isAiGenerated,
//            cawgIdentityUrl, cawgIdentityName, trainingMiningOptOut }
//
// Loads the asset + active project, calls signAsset(), then repoints filePath
// to the signed copy and stores the manifest summary on the asset record.
// Original file is preserved at original_file_path (project policy: keep all
// originals during v0.2).

import { Router } from 'express';
import { signAsset } from '../lib/extraction/c2pa-sign.js';
import { getActiveProject } from '../lib/projects.js';
import { getProducedAsset, applySignature as applyProducedSig } from '../lib/produced/produced.js';
import { getAsset, applySignature as applyAiSig } from '../lib/assets/assets.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('sign-route');

const router = Router();

router.post('/:type/:id', async (req, res) => {
	const { type, id } = req.params;
	const assetId = parseInt(id);
	if (!['produced', 'ai'].includes(type)) {
		return res.status(400).json({ error: `type must be "produced" or "ai", got "${type}"` });
	}

	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	if (!project.certificatePath || !project.privateKeyPath) {
		return res.status(400).json({ error: 'Project has no certificate or private key configured. Run `npm run cert:generate` and set the paths in Project Settings.' });
	}

	const asset = type === 'produced' ? await getProducedAsset(assetId) : await getAsset(assetId);
	if (!asset) return res.status(404).json({ error: `${type} asset ${assetId} not found` });

	const {
		creatorName,
		organization,
		toolUsed,
		isAiGenerated,
		cawgIdentityUrl,
		cawgIdentityName,
		trainingMiningOptOut
	} = req.body || {};

	if (!creatorName) return res.status(400).json({ error: 'creatorName is required' });
	if (!toolUsed) return res.status(400).json({ error: 'toolUsed is required' });

	try {
		const result = await signAsset({
			inputPath: asset.filePath,
			creatorName,
			organization,
			toolUsed,
			isAiGenerated: !!isAiGenerated,
			cawgIdentityUrl: cawgIdentityUrl || project.cawgIdentityUrl || '',
			cawgIdentityName: cawgIdentityName || project.cawgIdentityName || '',
			trainingMiningOptOut: trainingMiningOptOut !== false,
			certificatePath: project.certificatePath,
			privateKeyPath: project.privateKeyPath
		});

		const c2paJson = JSON.stringify(result.c2paSummary || {});
		const updated = type === 'produced'
			? await applyProducedSig(assetId, {
				signedPath: result.signedPath,
				fileHash: result.fileHash,
				fileSize: result.fileSize,
				mimeType: result.mimeType,
				c2paJson,
				originalFilePath: asset.filePath
			})
			: await applyAiSig(assetId, {
				signedPath: result.signedPath,
				fileHash: result.fileHash,
				fileSize: result.fileSize,
				mimeType: result.mimeType,
				c2paJson,
				originalFilePath: asset.filePath
			});

		log.info(`signed ${type} asset ${assetId}: ${result.signedPath}`);
		res.json(updated);
	} catch (err) {
		log.error(`sign failed for ${type}/${assetId}:`, err.message);
		res.status(500).json({ error: err.message });
	}
});

export default router;
