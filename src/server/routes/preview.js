import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import { getMimeType } from '../lib/core/file-utils.js';

const router = Router();

// Streams a local file for the UI. Honours HTTP Range requests so <video>
// and <audio> can seek (the player sends ranges once it knows the length;
// without 206 responses seeking rewinds to the start).
router.get('/', (req, res) => {
	const filePath = req.query.path;
	if (!filePath) return res.status(400).json({ error: 'path required' });

	const resolved = path.resolve(filePath);
	if (!existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

	const { size } = statSync(resolved);
	const mimeType = getMimeType(resolved);
	res.setHeader('Content-Type', mimeType);
	res.setHeader('Cache-Control', 'public, max-age=3600');
	res.setHeader('Accept-Ranges', 'bytes');

	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
	if (range && size > 0) {
		let start = range[1] === '' ? Math.max(0, size - parseInt(range[2])) : parseInt(range[1]);
		let end = range[2] === '' || range[1] === '' ? size - 1 : Math.min(parseInt(range[2]), size - 1);
		if (Number.isNaN(start) || start >= size || start > end) {
			res.setHeader('Content-Range', `bytes */${size}`);
			return res.status(416).end();
		}
		res.status(206);
		res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
		res.setHeader('Content-Length', end - start + 1);
		return createReadStream(resolved, { start, end }).pipe(res);
	}

	res.setHeader('Content-Length', size);
	createReadStream(resolved).pipe(res);
});

export default router;
