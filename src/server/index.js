import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { pool } from './db/index.js';
import { createLogger } from './lib/logger.js';
import { startQueueWorker, releaseStaleLeases } from './lib/search/queue.js';
import { startSearchJobWorker, releaseStaleSearchJobs } from './lib/search/search-jobs.js';

const log = createLogger('server');

import projectsRouter from './routes/projects.js';
import archivalRouter from './routes/archival.js';
import assetsRouter from './routes/assets.js';
import extractRouter from './routes/extract.js';
import notionRouter from './routes/notion.js';
import previewRouter from './routes/preview.js';
import producedRouter from './routes/produced.js';
import uploadRouter from './routes/upload.js';
import searchRouter from './routes/search.js';
import searchGroupsRouter from './routes/search-groups.js';
import signRouter from './routes/sign.js';
import originRouter from './routes/origin.js';
import relationshipsRouter from './routes/relationships.js';
import timelinesRouter from './routes/timelines.js';
import outputsRouter from './routes/outputs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));

app.use(express.json({ limit: '10mb' }));
// Express 5 leaves req.body undefined when a request carries no JSON body
// (Express 4 gave {}). Routes destructure req.body, so keep the old shape.
app.use((req, _res, next) => {
	if (req.body === undefined) req.body = {};
	next();
});

// Liveness/readiness probe. Returns 200 if the server can reach the DB, 503 otherwise.
// Useful for reverse-proxy health checks and for anyone self-hosting behind systemd/pm2.
app.get('/api/health', async (_req, res) => {
	try {
		await pool.query('SELECT 1');
		res.json({ ok: true, db: true, version: pkg.version });
	} catch (err) {
		res.status(503).json({ ok: false, db: false, version: pkg.version, error: err.message });
	}
});

// API routes
app.use('/api/projects', projectsRouter);
app.use('/api/archival', archivalRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/extract', extractRouter);
app.use('/api/notion', notionRouter);
app.use('/api/preview', previewRouter);
app.use('/api/produced', producedRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/search', searchRouter);
app.use('/api/search-groups', searchGroupsRouter);
app.use('/api/sign', signRouter);
app.use('/api/origin', originRouter);
app.use('/api/relationships', relationshipsRouter);
app.use('/api/timelines', timelinesRouter);
app.use('/api/outputs', outputsRouter);

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
	const distPath = path.resolve(__dirname, '../../dist');
	app.use(express.static(distPath));
	// Express 5 path syntax: a bare "*" is no longer valid; a named splat is.
	app.get('/{*splat}', (req, res) => {
		res.sendFile(path.join(distPath, 'index.html'));
	});
}

// Express 5 forwards rejected promises from async routes here. Answer in JSON
// so the client never gets an HTML stack page.
app.use((err, _req, res, _next) => {
	log.error(err.stack || err.message);
	res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, async () => {
	log.info(`✓ Provenance Tracker API running on http://localhost:${PORT}`);
	if (!process.env.APP_CONTACT) {
		log.warn('APP_CONTACT is not set. Archive Search calls Wikimedia, whose User-Agent policy requires identification (email or URL). Unidentified clients are throttled or blocked — set APP_CONTACT in .env if you plan to use the archival module.');
	}
	await releaseStaleLeases().catch(err => log.error('lease release failed:', err.message));
	await releaseStaleSearchJobs().catch(err => log.error('search-job lease release failed:', err.message));
	startQueueWorker();
	startSearchJobWorker();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
	await pool.end();
	process.exit(0);
});

// Surface crashes instead of hanging silently. uncaughtException may leave state
// corrupt, so exit and let the supervisor (node --watch, pm2, systemd) restart.
// unhandledRejection is logged but non-fatal — usually a missing .catch() on a
// background job, where killing the whole server would be overkill.
process.on('uncaughtException', (err) => {
	log.error('uncaught exception (fatal):', err);
	process.exit(1);
});
process.on('unhandledRejection', (reason) => {
	log.warn('unhandled promise rejection:', reason);
});
