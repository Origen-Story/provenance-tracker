import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db/index.js';
import { startQueueWorker, releaseStaleLeases } from './lib/search/queue.js';

import projectsRouter from './routes/projects.js';
import archivalRouter from './routes/archival.js';
import assetsRouter from './routes/assets.js';
import extractRouter from './routes/extract.js';
import notionRouter from './routes/notion.js';
import previewRouter from './routes/preview.js';
import producedRouter from './routes/produced.js';
import uploadRouter from './routes/upload.js';
import searchRouter from './routes/search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '10mb' }));

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

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
	const distPath = path.resolve(__dirname, '../../dist');
	app.use(express.static(distPath));
	app.get('*', (req, res) => {
		res.sendFile(path.join(distPath, 'index.html'));
	});
}

app.listen(PORT, async () => {
	console.log(`✓ Provenance Tracker API running on http://localhost:${PORT}`);
	await releaseStaleLeases().catch(err => console.error('[startup] lease release failed:', err.message));
	startQueueWorker();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
	await pool.end();
	process.exit(0);
});
