/**
 * Background search-execution queue.
 *
 * Runs Wikimedia group searches out-of-band so the HTTP request returns in ~50ms
 * and the long-running work survives server restarts, client disconnects, and
 * editor file-watches. Mirrors the candidate approval queue in queue.js.
 *
 * A job row in search_jobs tracks progress counters the UI can poll for a
 * progress bar. Cancellation flips status to 'cancelled'; the running search
 * checks between keywords/categories and bails.
 */

import { db } from '../../db/index.js';
import { searchJobs } from '../../db/schema.js';
import { eq, and, sql, asc, desc, or, lt, inArray } from 'drizzle-orm';
import { createLogger } from '../logger.js';
import { executeGroupSearch } from './search.js';
import { getGroupByGroupId } from './groups.js';

const log = createLogger('search-jobs');
const POLL_INTERVAL_MS = 2000;
const LEASE_SECONDS = 120;    // longer than candidate queue — a single job can take minutes

let _running = false;
let _timer = null;

export function startSearchJobWorker() {
	if (_timer) return;
	log.info(`Starting worker (poll every ${POLL_INTERVAL_MS}ms)`);
	_timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopSearchJobWorker() {
	if (_timer) clearInterval(_timer);
	_timer = null;
}

async function tick() {
	if (_running) return; // one search at a time to respect Wikimedia rate limits
	_running = true;
	try {
		const job = await claimNext();
		if (!job) return;

		log.info(`PICK job ${job.id} — group "${job.groupName}"`);

		const group = await getGroupByGroupId(job.projectId, job.groupId);
		if (!group) {
			await markFailed(job.id, `Group "${job.groupId}" no longer exists`);
			return;
		}

		try {
			await executeGroupSearch(job.projectId, group, job.id);
			// executeGroupSearch marks status='completed' itself so it can write final counters in one transaction
		} catch (err) {
			if (err?.code === 'CANCELLED') {
				log.info(`CANCEL job ${job.id}`);
				return;
			}
			log.error(`FAIL job ${job.id}:`, err.message);
			await markFailed(job.id, err.message || String(err));
		}
	} catch (err) {
		log.error('tick error:', err.message);
	} finally {
		_running = false;
	}
}

// Claim the next queued (or stale-leased) job by flipping it to 'running' with a fresh lease.
async function claimNext() {
	const rows = await db.select().from(searchJobs)
		.where(or(
			eq(searchJobs.status, 'queued'),
			and(eq(searchJobs.status, 'running'), lt(searchJobs.leaseUntil, sql`now()`))
		))
		.orderBy(asc(searchJobs.createdAt), asc(searchJobs.id))
		.limit(1);
	if (rows.length === 0) return null;
	const job = rows[0];

	const [claimed] = await db.update(searchJobs)
		.set({
			status: 'running',
			startedAt: job.startedAt || sql`now()`,
			leaseUntil: sql`now() + interval '${sql.raw(String(LEASE_SECONDS))} seconds'`,
			updatedAt: sql`now()`
		})
		.where(and(eq(searchJobs.id, job.id), eq(searchJobs.status, job.status)))
		.returning();
	return claimed || null;
}

async function markFailed(jobId, errorMsg) {
	await db.update(searchJobs)
		.set({
			status: 'failed',
			lastError: errorMsg,
			completedAt: sql`now()`,
			updatedAt: sql`now()`
		})
		.where(eq(searchJobs.id, jobId));
}

// On startup: release leases from a prior process so orphaned 'running' jobs
// become re-claimable. They go back to 'queued' to be re-run from scratch.
export async function releaseStaleSearchJobs() {
	const rows = await db.update(searchJobs)
		.set({
			status: 'queued',
			leaseUntil: null,
			updatedAt: sql`now()`
		})
		.where(eq(searchJobs.status, 'running'))
		.returning({ id: searchJobs.id });
	if (rows.length > 0) {
		log.info(`Re-queued ${rows.length} orphan job${rows.length !== 1 ? 's' : ''} from prior run`);
	}
}

// ---------------------------------------------------------------------------
// Public API — used by routes
// ---------------------------------------------------------------------------

export async function enqueueSearch(projectId, group) {
	const keywordsTotal = Object.values(group.keywords || {}).reduce(
		(n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0
	);
	const categoriesTotal = (group.categories || []).length;

	const [job] = await db.insert(searchJobs).values({
		projectId,
		groupId: group.groupId,
		groupName: group.groupName,
		status: 'queued',
		keywordsTotal,
		categoriesTotal
	}).returning();
	return job;
}

export async function getJob(id) {
	const [row] = await db.select().from(searchJobs).where(eq(searchJobs.id, id)).limit(1);
	return row || null;
}

export async function listJobs(projectId, { limit = 20 } = {}) {
	return await db.select().from(searchJobs)
		.where(eq(searchJobs.projectId, projectId))
		.orderBy(desc(searchJobs.createdAt))
		.limit(limit);
}

export async function cancelJob(id) {
	// Only cancel jobs that haven't finished. Worker checks between iterations and exits.
	const rows = await db.update(searchJobs)
		.set({
			status: 'cancelled',
			completedAt: sql`now()`,
			updatedAt: sql`now()`
		})
		.where(and(eq(searchJobs.id, id), inArray(searchJobs.status, ['queued', 'running'])))
		.returning();
	return rows[0] || null;
}

// Retry a failed/cancelled job: flip back to 'queued' and zero progress counters
// so the worker re-runs from scratch. Safe to call repeatedly.
export async function retryJob(id) {
	const rows = await db.update(searchJobs)
		.set({
			status: 'queued',
			lastError: '',
			completedAt: null,
			leaseUntil: null,
			startedAt: null,
			keywordsDone: 0,
			categoriesDone: 0,
			uniqueTitles: 0,
			candidatesInserted: 0,
			skippedLicense: 0,
			skippedDuplicate: 0,
			skippedExisting: 0,
			updatedAt: sql`now()`
		})
		.where(and(eq(searchJobs.id, id), inArray(searchJobs.status, ['failed', 'cancelled'])))
		.returning();
	return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Progress helpers — called by executeGroupSearch as it runs
// ---------------------------------------------------------------------------

export async function updateProgress(jobId, patch) {
	await db.update(searchJobs)
		.set({
			...patch,
			leaseUntil: sql`now() + interval '${sql.raw(String(LEASE_SECONDS))} seconds'`,
			updatedAt: sql`now()`
		})
		.where(eq(searchJobs.id, jobId));
}

// Returns true if the job has been cancelled externally. Search loop checks this
// between keywords/categories so cancellation is responsive without a separate channel.
export async function isCancelled(jobId) {
	const job = await getJob(jobId);
	return job?.status === 'cancelled';
}

export async function markCompleted(jobId, finalCounters) {
	await db.update(searchJobs)
		.set({
			...finalCounters,
			status: 'completed',
			completedAt: sql`now()`,
			leaseUntil: null,
			updatedAt: sql`now()`
		})
		.where(eq(searchJobs.id, jobId));
}
