/**
 * Background approval queue.
 *
 * Candidates marked `status='processing'` sit in this queue. A poll loop picks
 * the next due item, downloads + creates the archival asset, and updates state.
 *
 * Retryable errors (429, network, 5xx) → bump retryCount, schedule next attempt.
 * Permanent errors (duplicate hash, invalid URL, 404) → status='rejected' or 'failed'.
 * After MAX_RETRIES attempts on retryable errors → status='failed' with last error message.
 */

import { db } from '../../db/index.js';
import { searchCandidates } from '../../db/schema.js';
import { eq, and, sql, or, isNull, lte, asc } from 'drizzle-orm';
import { createLogger } from '../logger.js';
import { processOne } from './search.js';
import { getActiveProject } from '../projects.js';

const log = createLogger('queue');
const POLL_INTERVAL_MS = 5000;     // one pickup attempt per tick (conservative to stay under Wikimedia rate limits)
const LEASE_SECONDS = 60;          // claim window so crashes don't re-pick immediately
const MAX_RETRIES = 5;
// Backoff schedule (seconds) keyed by retryCount AFTER bump. Index = attempt number.
// Server-sent Retry-After overrides this when present on 429 responses.
const BACKOFF_SECONDS = [15, 45, 120, 300, 600];

let _running = false;
let _timer = null;

export function startQueueWorker() {
	if (_timer) return;
	log.info(`Starting worker (poll every ${POLL_INTERVAL_MS}ms, max ${MAX_RETRIES} retries)`);
	_timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopQueueWorker() {
	if (_timer) clearInterval(_timer);
	_timer = null;
}

async function tick() {
	if (_running) return; // serialize — only one in-flight at a time
	_running = true;
	try {
		const project = await getActiveProject();
		if (!project) return;

		const candidate = await claimNext();
		if (!candidate) return;

		const attempt = (candidate.retryCount || 0) + 1;
		log.info(`PICK  candidate ${candidate.id} "${(candidate.title || '').slice(0, 60)}" (attempt ${attempt}/${MAX_RETRIES})`);

		try {
			const asset = await processOne(project.id, candidate, project.storagePath);
			await db.update(searchCandidates)
				.set({ status: 'approved', archivalAssetId: asset.id, lastError: '', updatedAt: sql`now()` })
				.where(eq(searchCandidates.id, candidate.id));
			log.info(`OK    candidate ${candidate.id} → asset ${asset.id}`);
		} catch (err) {
			await handleFailure(candidate, attempt, err);
		}
	} catch (err) {
		log.error('tick error:', err.message);
	} finally {
		_running = false;
	}
}

// Atomically pick the next due row and extend its lease so a crash doesn't double-process.
async function claimNext() {
	const rows = await db.select().from(searchCandidates)
		.where(and(
			eq(searchCandidates.status, 'processing'),
			or(isNull(searchCandidates.nextAttemptAt), lte(searchCandidates.nextAttemptAt, sql`now()`))
		))
		.orderBy(asc(searchCandidates.nextAttemptAt), asc(searchCandidates.id))
		.limit(1);
	if (rows.length === 0) return null;
	const row = rows[0];

	// Extend lease — if work crashes/hangs, we won't re-pick for LEASE_SECONDS
	await db.update(searchCandidates)
		.set({ nextAttemptAt: sql`now() + interval '${sql.raw(String(LEASE_SECONDS))} seconds'`, updatedAt: sql`now()` })
		.where(eq(searchCandidates.id, row.id));
	return row;
}

async function handleFailure(candidate, attempt, err) {
	const cls = classifyError(err);
	const msg = err.message || String(err);

	if (cls === 'permanent-duplicate') {
		// processOne already set status='rejected' with the reason; nothing to do.
		log.info(`DUP   candidate ${candidate.id} — ${msg}`);
		return;
	}

	if (cls === 'permanent') {
		await db.update(searchCandidates)
			.set({ status: 'failed', lastError: msg, retryCount: attempt, updatedAt: sql`now()` })
			.where(eq(searchCandidates.id, candidate.id));
		log.warn(`FAIL  candidate ${candidate.id} — permanent: ${msg}`);
		return;
	}

	// retryable
	if (attempt >= MAX_RETRIES) {
		await db.update(searchCandidates)
			.set({ status: 'failed', lastError: msg, retryCount: attempt, updatedAt: sql`now()` })
			.where(eq(searchCandidates.id, candidate.id));
		log.warn(`FAIL  candidate ${candidate.id} — gave up after ${attempt} attempts: ${msg}`);
		return;
	}

	// Honor server-sent Retry-After (seconds) when present, otherwise use our schedule
	const retryAfterMatch = msg.match(/\[retry-after:(\d+)\]/);
	const defaultWait = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
	const waitSec = retryAfterMatch ? Math.max(parseInt(retryAfterMatch[1]), defaultWait) : defaultWait;
	await db.update(searchCandidates)
		.set({
			retryCount: attempt,
			lastError: msg,
			nextAttemptAt: sql`now() + interval '${sql.raw(String(waitSec))} seconds'`,
			updatedAt: sql`now()`
		})
		.where(eq(searchCandidates.id, candidate.id));
	log.info(`RETRY candidate ${candidate.id} — attempt ${attempt}/${MAX_RETRIES} failed, next in ${waitSec}s: ${msg}`);
}

function classifyError(err) {
	const msg = (err.message || String(err)).toLowerCase();
	if (msg.startsWith('duplicate')) return 'permanent-duplicate';
	if (msg.includes('did not return an image')) return 'permanent';
	if (/\b(404|400|403|410)\b/.test(msg)) return 'permanent';
	if (/\b429\b/.test(msg)) return 'retryable';
	if (/\b(500|502|503|504)\b/.test(msg)) return 'retryable';
	if (/econn|etimedout|enotfound|fetch failed|network/.test(msg)) return 'retryable';
	// Unknown — assume retryable; MAX_RETRIES caps exposure.
	return 'retryable';
}

// On startup, release any leases from a prior process so those rows become pickable again
export async function releaseStaleLeases() {
	// Rows still in 'processing' that were claimed before the current process started —
	// clear the future lease so they're due immediately.
	const result = await db.update(searchCandidates)
		.set({ nextAttemptAt: sql`now()`, updatedAt: sql`now()` })
		.where(and(
			eq(searchCandidates.status, 'processing'),
			sql`${searchCandidates.nextAttemptAt} > now()`
		))
		.returning({ id: searchCandidates.id });
	if (result.length > 0) {
		log.info(`Released ${result.length} stale lease${result.length !== 1 ? 's' : ''} from prior run`);
	}
}

// Manual retry — reset a failed candidate so the worker picks it up again
export async function retryCandidate(id) {
	await db.update(searchCandidates)
		.set({ status: 'processing', retryCount: 0, nextAttemptAt: sql`now()`, lastError: '', updatedAt: sql`now()` })
		.where(eq(searchCandidates.id, id));
}
