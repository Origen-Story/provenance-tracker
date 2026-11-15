import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { mkdir, rename, rm } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import path from 'path';
import { getMimeType } from '../lib/core/file-utils.js';
import { thumbnailKey, frameTime, frameArgs, durationArgs } from '../lib/core/thumbnail.js';
import { createLogger } from '../lib/logger.js';

const router = Router();
const log = createLogger('preview');
const execFileP = promisify(execFile);

// ---------- video frames for the asset grids ----------
// ffmpeg is optional: without it the route answers 501 and the card keeps
// its icon. FFMPEG_PATH / FFPROBE_PATH override the copies on PATH.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const THUMB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/thumbnails');
const MAX_RUNNING = 3;
const inFlight = new Map();
let running = 0;
const waiting = [];
let ffmpegMissing = false;

async function limited(fn) {
	if (running >= MAX_RUNNING) await new Promise(resolve => waiting.push(resolve));
	running++;
	try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

async function makeFrame(input, output) {
	let duration = 0;
	try {
		duration = (await execFileP(FFPROBE, durationArgs(input), { timeout: 20000, windowsHide: true })).stdout.trim();
	} catch (err) {
		if (err.code === 'ENOENT') throw err;
	}
	await mkdir(THUMB_DIR, { recursive: true });
	const tmp = `${output}.${process.pid}.tmp.webp`;
	try {
		await execFileP(FFMPEG, frameArgs({ input, output: tmp, at: frameTime(duration) }), { timeout: 60000, windowsHide: true });
		await rename(tmp, output);
	} finally {
		await rm(tmp, { force: true });
	}
}

router.get('/frame', async (req, res) => {
	const filePath = req.query.path;
	if (!filePath) return res.status(400).json({ error: 'path required' });
	const resolved = path.resolve(filePath);
	if (!existsSync(resolved)) return res.status(404).json({ error: 'File not found' });
	if (!getMimeType(resolved).startsWith('video/')) return res.status(415).json({ error: 'Not a video' });
	if (ffmpegMissing) return res.status(501).json({ error: 'ffmpeg is not installed' });

	const output = path.join(THUMB_DIR, thumbnailKey(resolved, statSync(resolved)));
	try {
		if (!existsSync(output)) {
			if (!inFlight.has(output)) {
				inFlight.set(output, limited(() => makeFrame(resolved, output)).finally(() => inFlight.delete(output)));
			}
			await inFlight.get(output);
		}
	} catch (err) {
		if (err.code === 'ENOENT') {
			ffmpegMissing = true;
			log.warn('ffmpeg or ffprobe was not found; video cards keep their icon. Install ffmpeg or set FFMPEG_PATH and FFPROBE_PATH.');
			return res.status(501).json({ error: 'ffmpeg is not installed' });
		}
		log.warn(`No frame for ${path.basename(resolved)}: ${(err.stderr || err.message || '').trim().split('\n').at(-1)}`);
		return res.status(422).json({ error: 'Could not read a frame' });
	}
	res.setHeader('Cache-Control', 'public, max-age=3600');
	res.type('image/webp').sendFile(output);
});

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
