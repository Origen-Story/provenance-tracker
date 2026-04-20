import { Router } from 'express';
import { getActiveProject } from '../lib/projects.js';
import { getStopById, STOPS } from '../lib/search/stops.js';
import {
	executeStopSearch, listCandidates, getCandidate, getCandidateStats,
	updateCandidateStatus, bulkUpdateStatus, enqueueApproval, enqueueBulk, deleteCandidate
} from '../lib/search/search.js';
import { retryCandidate } from '../lib/search/queue.js';

const router = Router();

// List available stops
router.get('/stops', (req, res) => {
	const stops = STOPS.map(s => ({
		stopId: s.stopId,
		stopName: s.stopName,
		priority: s.priority,
		targetCount: s.targetCount,
		keywordCount: (s.keywords.en?.length || 0) + (s.keywords.ca?.length || 0) + (s.keywords.es?.length || 0),
		categoryCount: s.categories?.length || 0
	}));
	res.json(stops);
});

// Execute search for a stop
router.post('/execute', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { stopId } = req.body;
	if (!stopId) return res.status(400).json({ error: 'stopId required' });

	const stopConfig = getStopById(stopId);
	if (!stopConfig) return res.status(404).json({ error: 'Stop not found' });

	try {
		const result = await executeStopSearch(project.id, stopConfig);
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// List candidates with filters
router.get('/candidates', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { stopId = '', status = '', licenseTier = '', search = '', searchType = '', sort = 'createdAt', dir = 'desc', limit = 100, offset = 0 } = req.query;
	const result = await listCandidates(project.id, {
		stopId, status, licenseTier, search, searchType,
		sortBy: sort, sortDir: dir,
		limit: parseInt(limit), offset: parseInt(offset)
	});
	res.json(result);
});

// Single candidate detail
router.get('/candidates/:id', async (req, res) => {
	const candidate = await getCandidate(parseInt(req.params.id));
	if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
	res.json(candidate);
});

// Stats by stop + status
router.get('/stats', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	const stats = await getCandidateStats(project.id);
	res.json(stats);
});

// Update single candidate status
router.patch('/candidates/:id', async (req, res) => {
	const { status, rejectionReason } = req.body;
	if (!status) return res.status(400).json({ error: 'status required' });
	try {
		const updated = await updateCandidateStatus(parseInt(req.params.id), status, rejectionReason);
		res.json(updated);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Bulk status update
router.post('/candidates/bulk-status', async (req, res) => {
	const { ids, status, rejectionReason } = req.body;
	if (!ids?.length || !status) return res.status(400).json({ error: 'ids and status required' });
	try {
		const count = await bulkUpdateStatus(ids, status, rejectionReason);
		res.json({ updated: count });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Approve single candidate — enqueues for background processing
router.post('/candidates/:id/approve', async (req, res) => {
	try {
		await enqueueApproval(parseInt(req.params.id));
		res.json({ queued: 1 });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Bulk approve — enqueue all, worker handles downloads with retries/backoff
router.post('/candidates/bulk-approve', async (req, res) => {
	const { ids } = req.body;
	if (!ids?.length) return res.status(400).json({ error: 'ids required' });
	try {
		const count = await enqueueBulk(ids);
		console.log(`[search] Enqueued ${count} candidates for approval`);
		res.json({ queued: count });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Retry a failed candidate
router.post('/candidates/:id/retry', async (req, res) => {
	try {
		await retryCandidate(parseInt(req.params.id));
		res.json({ queued: 1 });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Delete candidate
router.delete('/candidates/:id', async (req, res) => {
	try {
		await deleteCandidate(parseInt(req.params.id));
		res.json({ success: true });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

export default router;
