import { Router } from 'express';
import { getActiveProject } from '../lib/projects.js';
import { createLogger } from '../lib/logger.js';
import { listGroups, getGroupByGroupId } from '../lib/search/groups.js';
import {
	listCandidates, getCandidate, getCandidateStats,
	updateCandidateStatus, bulkUpdateStatus, enqueueApproval, enqueueBulk, deleteCandidate
} from '../lib/search/search.js';
import { retryCandidate } from '../lib/search/queue.js';
import { enqueueSearch, getJob, listJobs, cancelJob, retryJob } from '../lib/search/search-jobs.js';

const router = Router();
const log = createLogger('search');

// Enqueue search for a group — returns a job id; client polls /jobs/:id for progress.
router.post('/execute', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const { groupId, stopId } = req.body;
	const gid = groupId || stopId;
	if (!gid) return res.status(400).json({ error: 'groupId required' });

	const group = await getGroupByGroupId(project.id, gid);
	if (!group) return res.status(404).json({ error: 'Group not found' });

	try {
		const job = await enqueueSearch(project.id, group);
		res.json({ jobId: job.id, status: job.status, groupId: job.groupId, groupName: job.groupName });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Get job progress (polled by UI while a search is in flight)
router.get('/jobs/:id', async (req, res) => {
	const job = await getJob(parseInt(req.params.id));
	if (!job) return res.status(404).json({ error: 'Job not found' });
	res.json(job);
});

// List recent jobs for the active project
router.get('/jobs', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	const limit = Math.min(parseInt(req.query.limit) || 20, 100);
	const jobs = await listJobs(project.id, { limit });
	res.json(jobs);
});

// Cancel a queued or running job
router.post('/jobs/:id/cancel', async (req, res) => {
	const job = await cancelJob(parseInt(req.params.id));
	if (!job) return res.status(404).json({ error: 'Job not found or already finished' });
	res.json(job);
});

// Retry a failed or cancelled job — re-queues it with counters reset to zero.
router.post('/jobs/:id/retry', async (req, res) => {
	const job = await retryJob(parseInt(req.params.id));
	if (!job) return res.status(404).json({ error: 'Job not found or not in a retryable state' });
	res.json(job);
});

// List candidates with filters
router.get('/candidates', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });

	const {
		searchGroupId = '', stopId = '',
		status = '', licenseTier = '', search = '', searchType = '',
		sortBy, sortDir, sort, dir,      // accept both names; `sort`/`dir` are the older aliases
		limit = 100, offset = 0
	} = req.query;
	const result = await listCandidates(project.id, {
		searchGroupId: searchGroupId || stopId,
		status, licenseTier, search, searchType,
		sortBy: sortBy || sort || 'createdAt',
		sortDir: sortDir || dir || 'desc',
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

// Stats by group + status
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
		log.info(`Enqueued ${count} candidates for approval`);
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
