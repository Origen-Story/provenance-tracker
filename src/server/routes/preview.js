import { Router } from 'express';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { getMimeType } from '../lib/core/file-utils.js';

const router = Router();

router.get('/', (req, res) => {
	const filePath = req.query.path;
	if (!filePath) return res.status(400).json({ error: 'path required' });

	const resolved = path.resolve(filePath);
	if (!existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

	const mimeType = getMimeType(resolved);
	res.setHeader('Content-Type', mimeType);
	res.setHeader('Cache-Control', 'public, max-age=3600');
	createReadStream(resolved).pipe(res);
});

export default router;
